import { describe, expect, test } from 'vitest';

import { waitingText } from './agent-log-status';

describe('waitingText', () => {
  test('says a held run is with the prestart automations', () => {
    expect(waitingText('held')).toMatch(/^Held: .*prestart automations/);
  });

  test('says a queued run is waiting for its device', () => {
    expect(waitingText('queued', { deviceKey: 'laptop' })).toBe(
      'Queued: waiting for laptop to pick this up…'
    );
    expect(waitingText('queued')).toBe(
      'Queued: waiting for the device to pick this up…'
    );
  });

  test('says a session-limit hold and when it lifts', () => {
    const now = Date.UTC(2026, 10, 26, 12);
    const text = waitingText('queued', {
      deviceKey: 'laptop',
      runAfter: now / 1000 + 3600,
      now,
    });
    expect(text).toMatch(
      /^Queued: laptop hit its session limit; it runs again/
    );
  });

  test('a hold that has passed reads as plain queued', () => {
    const now = Date.UTC(2026, 10, 26, 12);
    expect(
      waitingText('queued', {
        deviceKey: 'laptop',
        runAfter: now / 1000 - 60,
        now,
      })
    ).toBe('Queued: waiting for laptop to pick this up…');
  });

  test('says a running run has not written anything yet', () => {
    expect(waitingText('running')).toBe(
      'Running: waiting for its first output…'
    );
  });

  test('an ended job has nothing to wait for', () => {
    expect(waitingText('done')).toBeNull();
    expect(waitingText('error')).toBeNull();
    expect(waitingText('cancelled')).toBeNull();
  });
});
