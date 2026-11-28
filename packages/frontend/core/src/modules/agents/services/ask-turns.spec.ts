import { Framework } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

import { AskTurnsService, type AskTurnState } from './ask-turns';

const service = () => {
  const framework = new Framework();
  framework.service(AskTurnsService);
  return framework.provider().get(AskTurnsService);
};

const asked = {
  turns: [
    { role: 'user' as const, content: 'why did it fail?' },
    { role: 'assistant' as const, content: '' },
  ],
  history: [],
};

describe('AskTurnsService', () => {
  test('a turn is found by its chat until it ends, then dropped', () => {
    const turns = service();
    const turn = turns.begin('ask-1', asked);
    expect(turns.get('ask-1')).toBe(turn);
    expect(turn.state.busy).toBe(true);

    turn.end({ turns: asked.turns.slice(0, 1), history: [] });
    expect(turns.get('ask-1')).toBeUndefined();
    expect(turn.state.busy).toBe(false);
  });

  test('a panel that opens mid-answer is shown the reply so far, then the end', () => {
    const turns = service();
    const turn = turns.begin('ask-1', asked);
    // The panel that asked closes: nobody is watching.
    turn.update({
      turns: [asked.turns[0], { role: 'assistant', content: 'It timed' }],
    });

    const seen: AskTurnState[] = [];
    const reopened = turns.get('ask-1');
    expect(reopened?.state.turns.at(-1)?.content).toBe('It timed');
    reopened?.subscribe(state => seen.push(state));

    const failed = {
      turns: [
        asked.turns[0],
        { role: 'assistant' as const, content: 'Network error', error: true },
      ],
      history: [],
    };
    turn.end(failed);
    expect(seen.at(-1)).toMatchObject({ busy: false, turns: failed.turns });
  });

  test('nothing changes a turn once it has ended', () => {
    const turn = service().begin('ask-1', asked);
    const listener = vi.fn();
    turn.subscribe(listener);
    turn.end({ turns: [], history: [] });
    turn.update({ turns: asked.turns });
    turn.end({ turns: asked.turns, history: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(turn.state.turns).toEqual([]);
  });

  test('stopping a chat aborts its turn; a chat with none says so', () => {
    const turns = service();
    const turn = turns.begin('ask-1', asked);
    expect(turns.cancel('ask-1')).toBe(true);
    expect(turn.controller.signal.aborted).toBe(true);
    expect(turns.cancel('ask-2')).toBe(false);
  });

  test('a new turn in the same chat replaces, and stops, the old one', () => {
    const turns = service();
    const first = turns.begin('ask-1', asked);
    const second = turns.begin('ask-1', asked);
    expect(first.controller.signal.aborted).toBe(true);
    // The old turn ending late doesn't drop the new one.
    first.end({ turns: [], history: [] });
    expect(turns.get('ask-1')).toBe(second);
  });
});
