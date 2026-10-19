/**
 * Claude's messages as transcript lines, the same lines a Mac's runner
 * writes (workflow/deploy/job_exec.py Narrator), so a run's log in NotesGraph
 * reads alike wherever it ran.
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { type ChangeRecorder, toolResultText } from './changes';

const TOOL_RESULT_CHARS = 400;

export function short(value: unknown, limit = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const flat = (text ?? '').split(/\s+/).filter(Boolean).join(' ');
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

type Part = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  tool_use_id?: string;
};

/** NotesGraph's tools that find notes, whose results get a count. */
const NOTE_SEARCH_TOOLS = new Set(['semantic_search', 'keyword_search', 'search_blocks', 'list_blocks']);

const searchToolName = (name: string) => {
  const match = /^mcp__notesgraph__(\w+)$/.exec(name);
  return match && NOTE_SEARCH_TOOLS.has(match[1]) ? match[1] : null;
};

function collectDocIds(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectDocIds(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'docId' && typeof item === 'string' && item) into.add(item);
      else collectDocIds(item, into);
    }
  }
}

/**
 * How many notes a NotesGraph search found and in how many docs, from its
 * result as the MCP server words it (provider.ts): one text part per hit
 * (semantic_search's passages, keyword_search's `{docId, title}`s), or one
 * JSON part listing them (`{blocks}`, `{tasks}`). A passage names no doc, so
 * docs can be 0 when notes aren't.
 */
export function countFound(content: unknown): { notes: number; docs: number } {
  const parts = (
    Array.isArray(content) ? content.map(part => toolResultText([part])) : [String(content ?? '')]
  ).filter(part => part.trim());
  if (parts.length === 1 && /^No matching/i.test(parts[0].trim())) return { notes: 0, docs: 0 };
  const docIds = new Set<string>();
  let notes = 0;
  for (const part of parts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(part);
    } catch {
      notes += 1;
      continue;
    }
    collectDocIds(parsed, docIds);
    const list =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.values(parsed).find(Array.isArray)
        : parsed;
    notes += Array.isArray(list) ? list.length : 1;
  }
  return { notes, docs: docIds.size };
}

export const foundLine = ({ notes, docs }: { notes: number; docs: number }) => {
  const n = `${notes} ${notes === 1 ? 'note' : 'notes'}`;
  return docs ? `Found ${n} across ${docs} ${docs === 1 ? 'doc' : 'docs'}` : `Found ${n}`;
};

export class Narrator {
  result: string | null = null;
  error: string | null = null;
  steps = 0;
  cost: number | null = null;
  tokens: number | null = null;
  private started = false;
  /** NotesGraph searches awaiting their result, by tool_use id. */
  private readonly searches = new Map<string, string>();

  constructor(
    private readonly say: (line: string) => void,
    private readonly maxTurns?: number,
    /** Told of each tool call and its result, subagents' included. */
    private readonly changes?: ChangeRecorder
  ) {}

  private line(text: string, sub: boolean) {
    this.say(sub ? text.split('\n').map(l => `    ↳ ${l}`).join('\n') : text);
  }

  feed(message: SDKMessage): void {
    const event = message as SDKMessage & {
      parent_tool_use_id?: string | null;
      message?: { content?: Part[] | string };
    };
    const sub = !!event.parent_tool_use_id;
    if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') {
      if (sub) return;
      if (this.started) {
        // The same run picking up again after background work.
        this.say('▶ continuing');
        return;
      }
      this.started = true;
      const init = event as { model?: string; cwd?: string };
      this.say(`▶ started · model ${init.model ?? '?'} · ${init.cwd ?? ''}`);
    } else if (event.type === 'assistant') {
      if (!sub) this.steps += 1;
      const parts = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          this.line(part.text.trimEnd(), sub);
        } else if (part.type === 'tool_use') {
          const name = part.name ?? 'tool';
          if (name.endsWith('__ask_user')) {
            // The question is the event worth seeing, not the call.
            const question = (part.input as { question?: string } | undefined)?.question ?? '';
            this.line(`? asking you: ${question}  (answer in NotesGraph)`, sub);
          } else {
            this.line(`→ ${name}  ${short(part.input ?? {})}`, sub);
          }
          if (part.id && searchToolName(name)) this.searches.set(part.id, name);
          this.changes?.onToolUse(part.id, name, part.input);
        }
      }
    } else if (event.type === 'user') {
      const parts = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const part of parts) {
        if (part.type === 'tool_result') {
          const mark = part.is_error ? '✗' : '←';
          this.line(`  ${mark} ${short(toolResultText(part.content), TOOL_RESULT_CHARS)}`, sub);
          this.changes?.onToolResult(part.tool_use_id, part.content, part.is_error);
          const search = part.tool_use_id ? this.searches.get(part.tool_use_id) : undefined;
          if (search) {
            this.searches.delete(part.tool_use_id!);
            if (!part.is_error) this.line(`  ${foundLine(countFound(part.content))}`, sub);
          }
        }
      }
    } else if (event.type === 'result' && !sub) {
      this.steps = event.num_turns || this.steps;
      this.cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : this.cost;
      // modelUsage covers subagents too; `usage` is the main loop only.
      const usage = Object.values(event.modelUsage ?? {});
      if (usage.length) {
        this.tokens = usage.reduce(
          (sum, model) =>
            sum +
            (model.inputTokens ?? 0) +
            (model.outputTokens ?? 0) +
            (model.cacheReadInputTokens ?? 0) +
            (model.cacheCreationInputTokens ?? 0),
          0
        );
      }
      if (event.subtype === 'error_max_turns') {
        this.result = null;
        const limit = this.maxTurns ?? this.steps;
        this.error =
          `stopped at the ${limit}-turn limit without a final answer. ` +
          'Narrow the task or split it, then run it again.';
      } else if (event.is_error || event.subtype !== 'success') {
        this.result = null;
        const reason =
          ('result' in event && typeof event.result === 'string' && event.result) ||
          ('errors' in event && Array.isArray(event.errors) && event.errors.join('; ')) ||
          event.subtype;
        this.error =
          event.subtype === 'error_max_budget_usd'
            ? `stopped at its cost cap ($${this.cost?.toFixed(2) ?? '?'} spent)`
            : String(reason || 'failed');
      } else {
        this.result = event.result;
        this.error = null;
      }
    }
  }

  /** Say how the run ended, once, from its last result. */
  finish(): void {
    const tail = this.cost === null ? '' : ` · $${this.cost.toFixed(4)}`;
    if (this.error !== null) {
      this.say(`✗ failed after ${this.steps} turns${tail}: ${short(this.error, 300)}`);
    } else if (this.result !== null) {
      this.say(`✓ finished in ${this.steps} turns${tail}`);
    }
  }
}
