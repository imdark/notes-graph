import type {
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * The run's prompt, as an input stream that stays open until the run is
 * really over.
 *
 * The SDK closes the CLI's stdin as soon as the session goes idle after a
 * result and the input stream has ended. An agent that ends its turn to wait
 * on background work (a backgrounded Bash, a Monitor) is idle there, so stdin
 * closed; when the work finished, the CLI woke the agent with no channel left,
 * and every tool needing permission failed with "Tool permission request
 * failed: AbortError: Stream closed" (CLOUD-148, 2026-11-26).
 *
 * So the stream yields the prompt, then waits. Fed every message the run
 * sends, it ends at a result given while no background task is alive. A
 * result while one is alive keeps it open: the CLI wakes the agent when that
 * work finishes, and the next result is judged again. Should the last
 * background task end and nothing wake the agent within `quietMs`, it ends
 * then, so a run can't hang on an open stream.
 */
export class SessionInput {
  private live = new Set<string>();
  private resultSeen = false;
  private ended = false;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  private endInput!: () => void;
  private readonly over = new Promise<void>(resolve => {
    this.endInput = resolve;
  });

  constructor(
    private readonly text: string,
    private readonly quietMs = 120_000
  ) {}

  /** The stream to pass as `prompt`. */
  async *stream(): AsyncIterable<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: this.text },
      parent_tool_use_id: null,
    };
    await this.over;
  }

  /** Whether the stream has ended (for tests and logs). */
  get done(): boolean {
    return this.ended;
  }

  /** Every message the run sends, in order. */
  feed(message: SDKMessage): void {
    if (this.ended) return;
    const event = message as {
      type: string;
      subtype?: string;
      parent_tool_use_id?: string | null;
      tasks?: { task_id: string }[];
    };
    if (
      event.type === 'system' &&
      event.subtype === 'background_tasks_changed'
    ) {
      this.live = new Set((event.tasks ?? []).map(task => task.task_id));
      if (!this.live.size && this.resultSeen) this.armQuiet();
      return;
    }
    if (event.type === 'result' && !event.parent_tool_use_id) {
      this.resultSeen = true;
      if (!this.live.size) this.end();
      return;
    }
    // The agent is working again: a pending quiet end no longer applies.
    if (event.type === 'assistant' || event.type === 'stream_event') {
      this.resultSeen = false;
      this.clearQuiet();
    }
  }

  /** End the stream now: the run was stopped, or failed. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearQuiet();
    this.endInput();
  }

  private armQuiet() {
    this.clearQuiet();
    this.quietTimer = setTimeout(() => this.end(), this.quietMs);
  }

  private clearQuiet() {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
  }
}
