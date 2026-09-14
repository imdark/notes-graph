import {
  Button,
  Menu,
  MenuItem,
  Switch,
  useConfirmModal,
} from '@notesgraph/component';
import { SettingHeader } from '@notesgraph/component/setting-components';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import {
  type Agent,
  AgentIcon,
  type AgentDraft,
  type AgentScope,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { FrameworkScope, useLiveData, useService } from '@notesgraph/infra';
import { MoreHorizontalIcon } from '@blocksuite/icons/rc';
import { useCallback, useState } from 'react';

import { AgentEditor } from './agent-editor';
import * as styles from './styles.css';

const targetSummary = (agent: Agent) => {
  const labels: Record<string, string> = {
    block: 'block',
    selection: 'selection',
    doc: 'note',
  };
  const names = agent.targets.map(t => labels[t] ?? t);
  return names.length ? names.join(' · ') : 'nowhere';
};

const AgentList = ({
  title,
  desc,
  agents,
  onEdit,
  onDelete,
  onToggle,
  onDuplicate,
  onMove,
  moveLabel,
  emptyText,
}: {
  title: string;
  desc: string;
  agents: Agent[];
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onToggle: (agent: Agent, enabled: boolean) => void;
  onDuplicate: (agent: Agent) => void;
  onMove: (agent: Agent) => void;
  moveLabel: string;
  emptyText: string;
}) => (
  <div>
    <div className={styles.groupTitle}>{title}</div>
    <div className={styles.groupDesc}>{desc}</div>
    <div className={styles.list} style={{ marginTop: 10 }}>
      {agents.length === 0 ? (
        <div className={styles.empty}>{emptyText}</div>
      ) : (
        agents.map(agent => (
          <div key={agent.id} className={styles.row} data-testid="agent-row">
            <span className={styles.rowEmoji}>
              <AgentIcon agent={agent} />
            </span>
            <div className={styles.rowText}>
              <span className={styles.rowName}>{agent.name}</span>
              <span className={styles.rowMeta}>
                Runs on {targetSummary(agent)} · {agent.tools.length}{' '}
                {agent.tools.length === 1 ? 'tool' : 'tools'} · max{' '}
                {agent.maxSteps} steps
              </span>
            </div>
            <div className={styles.rowActions}>
              <Switch
                checked={agent.enabled}
                onChange={enabled => onToggle(agent, enabled)}
              />
              <Menu
                items={
                  <>
                    <MenuItem onClick={() => onEdit(agent)}>Edit</MenuItem>
                    <MenuItem onClick={() => onDuplicate(agent)}>
                      Duplicate
                    </MenuItem>
                    <MenuItem onClick={() => onMove(agent)}>
                      {moveLabel}
                    </MenuItem>
                    <MenuItem type="danger" onClick={() => onDelete(agent)}>
                      Delete
                    </MenuItem>
                  </>
                }
              >
                <Button
                  variant="plain"
                  prefix={<MoreHorizontalIcon />}
                  data-testid="agent-row-more"
                />
              </Menu>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

const WorkspaceSettingAgentsMain = () => {
  const agentsService = useService(AgentsService);
  const personal = useLiveData(agentsService.personalAgents$);
  const shared = useLiveData(agentsService.workspaceAgents$);
  const { openConfirmModal } = useConfirmModal();

  const [editing, setEditing] = useState<Agent | undefined>();
  const [creatingScope, setCreatingScope] = useState<AgentScope | undefined>();

  const handleCreate = useCallback(
    (draft: AgentDraft) => {
      if (!creatingScope) return;
      agentsService.create(creatingScope, draft);
    },
    [agentsService, creatingScope]
  );

  const handleEdit = useCallback(
    (draft: AgentDraft) => {
      if (!editing) return;
      agentsService.update(editing, draft);
    },
    [agentsService, editing]
  );

  const handleDelete = useCallback(
    (agent: Agent) => {
      openConfirmModal({
        title: `Delete "${agent.name}"?`,
        description:
          agent.scope === 'workspace'
            ? 'It will disappear for everyone in this workspace. Past runs stay in your history.'
            : 'Past runs stay in your history.',
        confirmText: 'Delete',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: () => agentsService.delete(agent),
      });
    },
    [agentsService, openConfirmModal]
  );

  return (
    <div className={styles.main}>
      <div className={styles.listHeader}>
        <div className={styles.groupDesc}>
          An agent is a saved instruction you can run against a block, a
          selection, or a whole note.
        </div>
        <Menu
          items={
            <>
              <MenuItem onClick={() => setCreatingScope('personal')}>
                Just for me
              </MenuItem>
              <MenuItem onClick={() => setCreatingScope('workspace')}>
                Shared with the workspace
              </MenuItem>
            </>
          }
        >
          <Button variant="primary" data-testid="new-agent">
            New agent
          </Button>
        </Menu>
      </div>

      <AgentList
        title="My agents"
        desc="Private to you, synced to your own devices."
        agents={personal}
        onEdit={setEditing}
        onDelete={handleDelete}
        onToggle={(agent, enabled) => agentsService.setEnabled(agent, enabled)}
        onDuplicate={agent => agentsService.duplicate(agent)}
        onMove={agent => agentsService.move(agent, 'workspace')}
        moveLabel="Share with workspace"
        emptyText="No agents yet."
      />

      <AgentList
        title="Workspace agents"
        desc="Shared with everyone in this workspace."
        agents={shared}
        onEdit={setEditing}
        onDelete={handleDelete}
        onToggle={(agent, enabled) => agentsService.setEnabled(agent, enabled)}
        onDuplicate={agent => agentsService.duplicate(agent)}
        onMove={agent => agentsService.move(agent, 'personal')}
        moveLabel="Make private to me"
        emptyText="No shared agents yet."
      />

      {creatingScope ? (
        <AgentEditor
          scope={creatingScope}
          open
          onOpenChange={open => !open && setCreatingScope(undefined)}
          onSubmit={handleCreate}
        />
      ) : null}

      {editing ? (
        <AgentEditor
          agent={editing}
          scope={editing.scope}
          open
          onOpenChange={open => !open && setEditing(undefined)}
          onSubmit={handleEdit}
        />
      ) : null}
    </div>
  );
};

export const WorkspaceSettingAgents = () => {
  const workspace = useService(WorkspaceService).workspace;
  const workspaceInfo = useWorkspaceInfo(workspace);

  if (workspace === null) {
    return null;
  }

  return (
    <FrameworkScope scope={workspace.scope}>
      <SettingHeader
        title="Agents"
        subtitle={`Agents in ${workspaceInfo?.name || 'this workspace'}`}
      />
      <WorkspaceSettingAgentsMain />
    </FrameworkScope>
  );
};
