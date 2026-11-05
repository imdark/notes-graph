import { describe, expect, test } from 'vitest';

import {
  MONITOR_CHAT_READINGS,
  monitorChatMessages,
  readingLines,
} from './monitor-chat';
import type { Monitor, MonitorReading } from './monitors';
import type { RemoteJob } from './remote-runner';

const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: 'm1',
  name: 'GPU price',
  docId: 'd1',
  blockId: 'b1',
  kind: 'agent',
  source: null,
  deviceKey: 'laptop',
  spec: { instructions: 'Find the RTX 5090 price at Micro Center.' },
  intervalMinutes: 60,
  condition: { type: 'below', value: 1800 },
  alerts: { inApp: true },
  enabled: true,
  nextRunAt: 0,
  lastRunAt: null,
  lastValue: null,
  lastError: null,
  pending: false,
  ...over,
});

const reading = (
  value: string | null,
  at: number,
  over: Partial<MonitorReading> = {}
): MonitorReading => ({
  value,
  error: null,
  changed: false,
  alerted: false,
  at,
  ...over,
});

describe('monitorChatMessages', () => {
  test('seeds the chat with the setup, readings and the latest run', () => {
    const run = {
      id: 'j1',
      status: 'done',
      result: 'RTX 5090 at $1,899 (Micro Center)',
      error: null,
      startedAt: 100,
    } as RemoteJob;
    const [system, record] = monitorChatMessages(monitor(), {
      readings: [reading('1899', 200, { alerted: true }), reading('1950', 100)],
      run,
      transcript: 'searched micro center',
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('"GPU price"');
    expect(system.content).toMatch(/cannot act/);
    expect(record.content).toContain('An agent run on laptop');
    expect(record.content).toContain('Find the RTX 5090 price');
    expect(record.content).toContain('Alerts when the value goes below 1800.');
    expect(record.content).toContain('1899 [alerted]');
    expect(record.content).toContain('<answer>\nRTX 5090 at $1,899');
    expect(record.content).toContain('searched micro center');
  });

  test('a url check with no readings says so and has no run', () => {
    const [, record] = monitorChatMessages(
      monitor({
        kind: 'check',
        source: 'url',
        deviceKey: null,
        spec: { url: 'https://example.com', extract: { type: 'number' } },
        condition: { type: 'change' },
      }),
      { readings: [] }
    );
    expect(record.content).toContain('A web check of https://example.com');
    expect(record.content).toContain('It has no readings yet.');
    expect(record.content).not.toContain('Latest run');
  });
});

describe('readingLines', () => {
  test('lists failures and caps how many go in', () => {
    const many = Array.from({ length: MONITOR_CHAT_READINGS + 5 }, (_, i) =>
      reading(String(i), i)
    );
    expect(readingLines(many).split('\n')).toHaveLength(MONITOR_CHAT_READINGS);
    expect(readingLines([reading(null, 0, { error: 'timed out' })])).toContain(
      'failed: timed out'
    );
  });
});
