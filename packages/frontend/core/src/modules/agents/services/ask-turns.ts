import { Service } from '@notesgraph/infra';

import type { SavedAskChat } from '../stores/agent-run-logs';
import type { ChatMessage } from './cloud-runner';

type Turn = SavedAskChat['turns'][number];

/** What a chat shows while a turn is answered, and once it has been. */
export interface AskTurnState {
  /** The shown turns, the reply so far last. */
  turns: Turn[];
  /** What the model has been sent after the opening; final once ended. */
  history: ChatMessage[];
  /** The reply is still coming. */
  busy: boolean;
}

/**
 * One question being answered. The chat panel that asked it may close and
 * another open on the same chat: the turn goes on either way, and whoever
 * is watching is told as it changes.
 */
export class LiveAskTurn {
  readonly controller = new AbortController();
  private listeners = new Set<(state: AskTurnState) => void>();

  constructor(
    private current: AskTurnState,
    private readonly onEnd: () => void = () => {}
  ) {}

  get state(): AskTurnState {
    return this.current;
  }

  get ended(): boolean {
    return !this.current.busy;
  }

  subscribe(listener: (state: AskTurnState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<Omit<AskTurnState, 'busy'>>): void {
    if (this.ended) return;
    this.set({ ...this.current, ...patch });
  }

  /** The turn is over: the chat as it now stands. */
  end(final: { turns: Turn[]; history: ChatMessage[] }): void {
    if (this.ended) return;
    this.set({ ...final, busy: false });
    this.onEnd();
  }

  cancel(): void {
    this.controller.abort();
  }

  private set(state: AskTurnState) {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}

/**
 * Ask turns in progress, by the chat they belong to (an ask row's id), so a
 * reply goes on when its chat panel is closed and is shown again, still
 * coming, when the chat is reopened. It ends as it would have with the panel
 * open: the answer, or the error, is kept in the chat's history.
 *
 * Lives as long as the workspace is open in this tab; closing the tab ends
 * the turn with it.
 */
export class AskTurnsService extends Service {
  private live = new Map<string, LiveAskTurn>();

  /** The turn being answered in chat `key`, if one is. */
  get(key: string): LiveAskTurn | undefined {
    return this.live.get(key);
  }

  /** Start a turn in chat `key`; it is dropped from here once it ends. */
  begin(key: string, state: Omit<AskTurnState, 'busy'>): LiveAskTurn {
    this.live.get(key)?.cancel();
    const turn = new LiveAskTurn({ ...state, busy: true }, () => {
      if (this.live.get(key) === turn) this.live.delete(key);
    });
    this.live.set(key, turn);
    return turn;
  }

  /** Stop the turn in chat `key`; false when none is being answered. */
  cancel(key: string): boolean {
    const turn = this.live.get(key);
    if (!turn) return false;
    turn.cancel();
    return true;
  }

  override dispose(): void {
    for (const turn of this.live.values()) turn.cancel();
    this.live.clear();
    super.dispose();
  }
}
