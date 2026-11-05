import type { Socket } from 'socket.io-client';
import { describe, expect, test } from 'vitest';

import { TerminalConnection, type TerminalSessionInfo } from './terminal';

const SESSION: TerminalSessionInfo = {
  id: 's1',
  deviceKey: 'mac',
  harness: 'shell',
  resume: null,
  status: 'running',
  exitCode: null,
  createdAt: 0,
  updatedAt: 0,
  length: 0,
};

/**
 * A socket whose server holds `printed` and answers `terminal:attach` only
 * when the test says so, so output can arrive while a catch-up is pending.
 */
const fakeSocket = () => {
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  const pending: (() => void)[] = [];
  let printed = '';
  const socket = {
    connected: true,
    on(event: string, fn: (...args: any[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    },
    off() {},
    timeout() {
      return socket;
    },
    emit(event: string, body: any, ack: (err: unknown, res: unknown) => void) {
      if (event !== 'terminal:attach') return ack(null, { data: {} });
      pending.push(() => {
        const from = Math.min(body.since, printed.length);
        ack(null, {
          data: { session: SESSION, data: printed.slice(from), from },
        });
      });
    },
  };
  return {
    socket: socket as unknown as Socket,
    /** The device prints `data`; viewers get it as an output frame. */
    print(data: string) {
      const offset = printed.length;
      printed += data;
      handlers
        .get('terminal:output')
        ?.forEach(fn => fn({ sessionId: 's1', data, offset }));
    },
    answer() {
      pending.splice(0).forEach(reply => reply());
    },
  };
};

const shown = (c: TerminalConnection) =>
  c.screen
    .spans()
    .map(r => r.map(x => x.text).join(''))
    .join('\n')
    .trim();

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('TerminalConnection', () => {
  test('output during a catch-up is shown once, and later output still shows', async () => {
    const server = fakeSocket();
    const c = new TerminalConnection(server.socket, 'ws', SESSION);
    server.print('one ');
    const syncing = c.sync();
    // Printed before the attach is answered: these overlap what it returns.
    server.print('two ');
    server.print('three ');
    server.answer();
    await syncing;
    await settle();
    server.answer();
    await settle();
    server.print('four');
    expect(shown(c)).toBe('one two three four');
  });

  test('a gap is fetched again', async () => {
    const server = fakeSocket();
    // Printed before this viewer was listening.
    server.print('a');
    const c = new TerminalConnection(server.socket, 'ws', SESSION);
    server.print('b');
    expect(shown(c)).toBe('');
    server.answer();
    await settle();
    expect(shown(c)).toBe('ab');
  });
});
