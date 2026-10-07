/**
 * Claude's messages as transcript lines, the same lines a Mac's runner
 * writes (workflow/deploy/job_exec.py Narrator), so a run's log in NotesGraph
 * reads alike wherever it ran.
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const TOOL_RESULT_CHARS = 400;

export function short(value: unknown, limit = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const flat = (text ?? '').split(/\s+/).filter(Boolean).join(' ');
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function toolResultText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('\n');
  }
  return String(content ?? '');
}

type Part = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };

export class Narrator {
  result: string | null = null;
  error: string | null = null;
  steps = 0;
  cost: number | null = null;
  private started = false;

  constructor(private readonly say: (line: string) => void) {}

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
        }
      }
    } else if (event.type === 'user') {
      const parts = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const part of parts) {
        if (part.type === 'tool_result') {
          const mark = part.is_error ? '✗' : '←';
          this.line(`  ${mark} ${short(toolResultText(part.content), TOOL_RESULT_CHARS)}`, sub);
        }
      }
    } else if (event.type === 'result' && !sub) {
      this.steps = event.num_turns || this.steps;
      this.cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : this.cost;
      if (event.is_error || event.subtype !== 'success') {
        this.result = null;
        const reason =
          ('result' in event && typeof event.result === 'string' && event.result) ||
          ('errors' in event && Array.isArray(event.errors) && event.errors.join('; ')) ||
          event.subtype;
        this.error = String(reason || 'failed');
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
