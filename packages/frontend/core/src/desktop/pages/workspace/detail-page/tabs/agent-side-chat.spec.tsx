/**
 * @vitest-environment happy-dom
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const tokens = vi.hoisted(() => ({
  CloudAgentRunnerService: class CloudAgentRunnerService {},
  WorkspaceService: class WorkspaceService {},
  AppThemeService: class AppThemeService {},
}));
const services = vi.hoisted(() => new Map<unknown, unknown>());

vi.mock('@notesgraph/infra', async () => ({
  ...(await vi.importActual<object>('@notesgraph/infra')),
  useService: (token: unknown) => services.get(token),
}));
vi.mock('@notesgraph/core/modules/agents', async () => ({
  ...tokens,
  ...(await vi.importActual<object>(
    '@notesgraph/core/modules/agents/services/ask-turns'
  )),
}));
vi.mock('@notesgraph/core/modules/workspace', () => ({
  WorkspaceService: tokens.WorkspaceService,
}));
vi.mock('@notesgraph/core/modules/theme', () => ({
  AppThemeService: tokens.AppThemeService,
}));
vi.mock('@notesgraph/core/blocksuite/ai/components/text-renderer', () => ({
  LitTextRenderer: () => null,
}));
vi.mock('@notesgraph/core/blocksuite/ai/effects/shared', () => ({
  registerAISharedEffects: () => {},
}));
vi.mock('@notesgraph/core/components/hooks/notesgraph/use-ai-specs', () => ({
  useAISpecs: () => [],
}));

import { AskTurnsService } from '@notesgraph/core/modules/agents/services/ask-turns';
import { Framework } from '@notesgraph/infra';

import { AgentSideChat, type SideChatRecord } from './agent-side-chat';

/** A model whose reply is fed by the test: chunks, then an end or a failure. */
function scriptedModel() {
  const chunks: string[] = [];
  let wake: (() => void) | null = null;
  let ending: { error?: Error } | null = null;
  const state = { signal: null as AbortSignal | null };
  const nudge = () => {
    wake?.();
    wake = null;
  };
  const model = async function* (_messages: unknown, signal: AbortSignal) {
    state.signal = signal;
    while (true) {
      while (chunks.length) yield chunks.shift() as string;
      if (ending) {
        if (ending.error) throw ending.error;
        return;
      }
      if (signal.aborted) throw new Error('aborted');
      await new Promise<void>(resolve => {
        wake = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  };
  return {
    open: async () => model,
    state,
    say: (text: string) => {
      chunks.push(text);
      nudge();
    },
    finish: () => {
      ending = {};
      nudge();
    },
    fail: (message: string) => {
      ending = { error: new Error(message) };
      nudge();
    },
  };
}

function recordOf(key: string | null) {
  return {
    key: key ? () => key : undefined,
    load: vi.fn(async () => null),
    asking: vi.fn(),
    ended: vi.fn(),
  } satisfies SideChatRecord;
}

const Chat = ({
  model,
  record,
}: {
  model: ReturnType<typeof scriptedModel>;
  record: SideChatRecord;
}) => (
  <AgentSideChat
    title="Ask about this run"
    hint="hint"
    placeholder="Ask"
    opening={async () => []}
    openModel={model.open}
    record={record}
    renderReply={reply => <p data-testid="reply">{reply}</p>}
    testId="chat"
  />
);

async function ask(question: string) {
  const input = await screen.findByTestId('chat-input');
  await waitFor(() =>
    expect(screen.getByTestId('chat-send').getAttribute('aria-disabled')).toBe(
      'true'
    )
  );
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByTestId('chat-send'));
}

let askTurns: AskTurnsService;

beforeEach(() => {
  const framework = new Framework();
  framework.service(AskTurnsService);
  askTurns = framework.provider().get(AskTurnsService);
  services.set(AskTurnsService, askTurns);
  services.set(tokens.WorkspaceService, { workspace: { id: 'w1' } });
  services.set(tokens.AppThemeService, {
    appTheme: { themeSignal: { value: 'light' } },
  });
  services.set(tokens.CloudAgentRunnerService, {});
});

afterEach(cleanup);

describe('AgentSideChat closed mid-answer', () => {
  test('a kept chat goes on answering, and its error is kept in the chat', async () => {
    const model = scriptedModel();
    const record = recordOf('ask-1');
    const view = render(<Chat model={model} record={record} />);
    await ask('Why did it fail?');
    await waitFor(() => expect(model.state.signal).not.toBeNull());

    view.unmount();
    expect(model.state.signal?.aborted).toBe(false);

    await act(async () => model.fail('The device went offline.'));
    await waitFor(() => expect(record.ended).toHaveBeenCalled());
    const [chat, , outcome] = record.ended.mock.calls[0];
    expect(outcome).toEqual({
      status: 'error',
      error: 'The device went offline.',
    });
    expect(chat.turns.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'The device went offline.',
      error: true,
    });
    expect(askTurns.get('ask-1')).toBeUndefined();
  });

  test('reopened while answering, it shows the reply as it comes and then the answer', async () => {
    const model = scriptedModel();
    const record = recordOf('ask-1');
    const first = render(<Chat model={model} record={record} />);
    await ask('What did it change?');
    await act(async () => model.say('It edited '));
    first.unmount();
    await act(async () => model.say('two notes.'));

    render(<Chat model={model} record={record} />);
    await waitFor(() =>
      expect(screen.getByTestId('reply').textContent).toBe(
        'It edited two notes.'
      )
    );
    expect(screen.getByTestId('chat-send').getAttribute('aria-label')).toBe(
      'Thinking…'
    );
    // The answer is still coming, so the kept copy isn't read over it.
    expect(record.load).toHaveBeenCalledTimes(1);

    await act(async () => model.finish());
    await waitFor(() =>
      expect(screen.getByTestId('chat-send').getAttribute('aria-label')).toBe(
        'Send'
      )
    );
    expect(record.ended).toHaveBeenCalledTimes(1);
    expect(record.ended.mock.calls[0][2]).toEqual({ status: 'done' });
    expect(record.ended.mock.calls[0][0].turns.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'It edited two notes.',
    });
  });

  test('a chat with nowhere to keep it stops when closed', async () => {
    const model = scriptedModel();
    const record = recordOf(null);
    const view = render(<Chat model={model} record={record} />);
    await ask('Why?');
    await waitFor(() => expect(model.state.signal).not.toBeNull());

    view.unmount();
    expect(model.state.signal?.aborted).toBe(true);
    await waitFor(() =>
      expect(record.ended.mock.calls[0]?.[2]).toEqual({ status: 'cancelled' })
    );
  });

  test('a turn stopped from the run list ends as stopped', async () => {
    const model = scriptedModel();
    const record = recordOf('ask-1');
    const view = render(<Chat model={model} record={record} />);
    await ask('Why?');
    await waitFor(() => expect(model.state.signal).not.toBeNull());
    view.unmount();

    expect(askTurns.cancel('ask-1')).toBe(true);
    await waitFor(() =>
      expect(record.ended.mock.calls[0]?.[2]).toEqual({ status: 'cancelled' })
    );
  });
});
