import { EditIcon, ToolIcon } from '@blocksuite/icons/rc';
import {
  Button,
  type IconData,
  IconPicker,
  IconRenderer,
  Input,
  Menu,
  MenuItem,
  Modal,
  Switch,
} from '@notesgraph/component';
import { AiIconGenerator } from '@notesgraph/core/blocksuite/block-suite-editor/doc-banner';
import {
  type Agent,
  agentIconData,
  type AgentDraft,
  type AgentHarness,
  type AgentScope,
  type AgentTargetKind,
  DEFAULT_MAX_STEPS,
  FILE_TOOLS,
} from '@notesgraph/core/modules/agents';
import {
  AIModelService,
  LOCAL_MODELS,
} from '@notesgraph/core/modules/ai-button/services/models';
import { useSignalValue } from '@notesgraph/core/modules/doc-info/utils';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './styles.css';

/**
 * The read-only MCP tools an agent may be given in phase 1. The executor
 * enforces this same list at call time — this is the picker, not the gate.
 */
const READ_TOOLS: { name: string; desc: string }[] = [
  { name: 'read_document', desc: 'Read one note in full' },
  { name: 'list_blocks', desc: "List a note's blocks" },
  { name: 'list_documents', desc: 'List notes in the workspace' },
  { name: 'semantic_search', desc: 'Meaning-based search' },
  { name: 'keyword_search', desc: 'Term-based search' },
  { name: 'search_blocks', desc: 'Search individual blocks' },
  { name: 'get_board', desc: 'Read a task board' },
  { name: 'get_backlinks', desc: 'What links here' },
  { name: 'get_links', desc: 'What this links to' },
];

interface ToolChoice {
  name: string;
  desc: string;
  group: string;
  mutates: boolean;
}

/**
 * Every tool an agent can be given, in one list.
 *
 * Notes and folder-file tools were two separate checkbox grids, which made the
 * dialog tall enough to push the save button off a short screen. One tag input
 * over a single catalog shows only what is actually selected.
 */
const ALL_TOOLS: ToolChoice[] = [
  ...READ_TOOLS.map(tool => ({ ...tool, group: 'Notes', mutates: false })),
  ...FILE_TOOLS.map(tool => ({
    name: tool.name,
    desc: tool.desc,
    group: 'Folder files',
    mutates: tool.mutates,
  })),
];

const toolByName = (name: string): ToolChoice | undefined =>
  ALL_TOOLS.find(tool => tool.name === name);

const HARNESSES: {
  value: AgentHarness | undefined;
  label: string;
  note: string;
}[] = [
  {
    value: undefined,
    label: 'Workspace default',
    note: "Follows the workspace's AI backend setting",
  },
  {
    value: 'on-device',
    label: 'On-device model',
    note: 'Runs in this browser via WebLLM',
  },
  {
    value: 'cloud',
    label: 'Cloud (server copilot)',
    note: 'Requires the server to advertise Copilot',
  },
];

const TARGETS: { kind: AgentTargetKind; label: string }[] = [
  { kind: 'block', label: 'A single block' },
  { kind: 'selection', label: 'A selection' },
  { kind: 'doc', label: 'A whole note' },
];

export interface AgentEditorProps {
  /** Editing an existing agent, or undefined when creating one. */
  agent?: Agent;
  /** Scope for a new agent; ignored when editing. */
  scope: AgentScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: AgentDraft) => void;
}

export const AgentEditor = ({
  agent,
  scope,
  open,
  onOpenChange,
  onSubmit,
}: AgentEditorProps) => {
  const [name, setName] = useState(agent?.name ?? '');
  const [icon, setIcon] = useState<IconData | undefined>(
    agent ? agentIconData(agent) : undefined
  );
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [tools, setTools] = useState<string[]>(
    agent?.tools ?? READ_TOOLS.slice(0, 5).map(t => t.name)
  );
  const [targets, setTargets] = useState<AgentTargetKind[]>(
    agent?.targets ?? ['block', 'selection', 'doc']
  );
  const [maxSteps, setMaxSteps] = useState(
    agent?.maxSteps ?? DEFAULT_MAX_STEPS
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [harness, setHarness] = useState<AgentHarness | undefined>(
    agent?.harness
  );
  const [model, setModel] = useState<string | undefined>(agent?.model);
  const modelService = useService(AIModelService);
  // A plain `.value` read wouldn't re-render when the list loads — the models
  // arrive asynchronously and depend on which backend is selected.
  const backendModels = useSignalValue(modelService.models) ?? [];
  // Follow the agent's own harness, not the workspace's backend setting —
  // picking "on-device" should offer on-device models even when the workspace
  // is pointed at the cloud.
  const availableModels =
    harness === 'on-device' ? LOCAL_MODELS : backendModels;

  // Tools not yet picked, so the menu only ever offers something new.
  const unusedTools = ALL_TOOLS.filter(tool => !tools.includes(tool.name));

  const toggle = useCallback(<T,>(list: T[], value: T): T[] => {
    return list.includes(value)
      ? list.filter(v => v !== value)
      : [...list, value];
  }, []);

  // A nameless agent is unpickable in a menu, and one with no target can never
  // be offered anywhere — block both rather than letting them be saved.
  const canSave = name.trim().length > 0 && targets.length > 0;

  const handleSubmit = useCallback(() => {
    if (!canSave) return;
    onSubmit({
      name: name.trim(),
      icon,
      instructions: instructions.trim(),
      harness,
      model,
      tools,
      targets,
      output: 'panel',
      maxSteps,
      enabled: agent?.enabled ?? true,
    });
    onOpenChange(false);
  }, [
    agent,
    canSave,
    harness,
    icon,
    instructions,
    model,
    maxSteps,
    name,
    onOpenChange,
    onSubmit,
    targets,
    tools,
  ]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={agent ? 'Edit agent' : 'New agent'}
      description={
        scope === 'workspace' && !agent
          ? 'Everyone in this workspace will be able to run it.'
          : undefined
      }
      width={560}
    >
      <div className={styles.editor}>
        <div className={styles.editorBody}>
          <div className={styles.field}>
            <span className={styles.label}>Name</span>
            <Input
              value={name}
              onChange={setName}
              placeholder="Break into subtasks"
              data-testid="agent-editor-name"
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Icon</span>
            <div className={styles.iconRow} data-testid="agent-editor-icon">
              {/* The icon itself stays on screen; the pen is what opens the
                picker, so the current choice is always visible rather than
                hidden behind a button you have to press to see. */}
              <span className={styles.iconPreview}>
                <IconRenderer data={icon} fallback={<ToolIcon />} />
              </span>
              <Menu
                rootOptions={{
                  open: pickerOpen,
                  onOpenChange: setPickerOpen,
                  modal: true,
                }}
                contentOptions={{
                  side: 'bottom',
                  align: 'start',
                  sideOffset: 4,
                }}
                items={
                  <div
                    onWheel={e => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'stretch' }}
                  >
                    <IconPicker
                      onSelect={data => {
                        setIcon(data);
                        setPickerOpen(false);
                      }}
                    />
                    <AiIconGenerator
                      subject={name.trim() || 'an assistant'}
                      onSelect={setIcon}
                      onApplied={() => setPickerOpen(false)}
                    />
                  </div>
                }
              >
                <Button
                  variant="plain"
                  prefix={<EditIcon />}
                  aria-label={icon ? 'Change icon' : 'Choose icon'}
                  title={icon ? 'Change icon' : 'Choose icon'}
                  data-testid="agent-editor-icon-edit"
                />
              </Menu>
              {icon ? (
                <Button variant="plain" onClick={() => setIcon(undefined)}>
                  Reset
                </Button>
              ) : null}
            </div>
            <span className={styles.hint}>
              Same picker as a note's icon — emoji, a built-in icon, or one
              generated with AI.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Instructions</span>
            <textarea
              className={styles.textarea}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Split this task into concrete subtasks. Keep each one to a single action."
              data-testid="agent-editor-instructions"
            />
            <span className={styles.hint}>
              The block or note being run against is supplied automatically.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Can be run on</span>
            <div className={styles.checkGrid}>
              {TARGETS.map(({ kind, label }) => (
                <label key={kind} className={styles.check}>
                  <Switch
                    checked={targets.includes(kind)}
                    onChange={() => setTargets(prev => toggle(prev, kind))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Tools</span>
            <div className={styles.tagInput} data-testid="agent-editor-tools">
              {tools.map(toolName => {
                const tool = toolByName(toolName);
                return (
                  <span
                    key={toolName}
                    className={styles.tag}
                    data-mutates={tool?.mutates ? 'true' : 'false'}
                    title={tool?.desc ?? toolName}
                  >
                    {toolName}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={`Remove ${toolName}`}
                      onClick={() =>
                        setTools(prev => prev.filter(t => t !== toolName))
                      }
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {unusedTools.length > 0 && (
                <Menu
                  contentOptions={{
                    side: 'bottom',
                    align: 'start',
                    sideOffset: 4,
                  }}
                  items={unusedTools.map(tool => (
                    <MenuItem
                      key={tool.name}
                      onSelect={() => setTools(prev => [...prev, tool.name])}
                    >
                      <span className={styles.tagMenuItem}>
                        <span>
                          {tool.name}
                          {tool.mutates ? ' · changes files' : ''}
                        </span>
                        <span className={styles.tagMenuDesc}>
                          {tool.group} — {tool.desc}
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                >
                  <button type="button" className={styles.tagAdd}>
                    + Add tool
                  </button>
                </Menu>
              )}
            </div>
            <span className={styles.hint}>
              Note tools are read-only. Folder-file tools need a bound folder,
              never reach outside it, and keep a backup before any overwrite or
              delete.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Runs on</span>
            <div className={styles.checkGrid}>
              {HARNESSES.map(({ value, label, note }) => (
                <label key={label} className={styles.check} title={note}>
                  <input
                    type="radio"
                    name="agent-harness"
                    checked={harness === value}
                    onChange={() => setHarness(value)}
                    data-testid={`agent-editor-harness-${value ?? 'default'}`}
                  />
                  {label}
                </label>
              ))}
            </div>
            <span className={styles.hint}>
              Only the on-device model runs agents today. Cloud needs the server
              to offer Copilot, which this one doesn't yet.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Model</span>
            <select
              className={styles.select}
              value={model ?? ''}
              onChange={e => setModel(e.target.value || undefined)}
              data-testid="agent-editor-model"
            >
              <option value="">Default for this runtime</option>
              {availableModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.category ? ` · ${m.category}` : ''}
                </option>
              ))}
            </select>
            <span className={styles.hint}>
              A different on-device model is downloaded the first time it runs.
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Step limit</span>
            <Input
              value={String(maxSteps)}
              onChange={value => {
                const parsed = Number.parseInt(value, 10);
                setMaxSteps(
                  Number.isFinite(parsed) && parsed > 0
                    ? parsed
                    : DEFAULT_MAX_STEPS
                );
              }}
              data-testid="agent-editor-max-steps"
            />
            <span className={styles.hint}>
              How many times the agent may call a tool before it has to answer.
            </span>
          </div>
        </div>

        <div className={styles.editorActions}>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={handleSubmit}
            data-testid="agent-editor-save"
          >
            {agent ? 'Save' : 'Create agent'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
