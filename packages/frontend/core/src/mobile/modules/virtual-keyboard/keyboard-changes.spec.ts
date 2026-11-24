import { describe, expect, test } from 'vitest';

import { createKeyboardChanges, type KeyboardChange } from './keyboard-changes';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('createKeyboardChanges', () => {
  test('emits a show once it is measured', async () => {
    const seen: KeyboardChange[] = [];
    const changes = createKeyboardChanges(c => seen.push(c));
    await changes.show(async () => ({ visible: true, height: 300 }));
    expect(seen).toEqual([{ visible: true, height: 300 }]);
  });

  test('a hide during the measurement wins over the late show', async () => {
    const seen: KeyboardChange[] = [];
    const changes = createKeyboardChanges(c => seen.push(c));
    const measured = deferred<KeyboardChange>();
    const shown = changes.show(() => measured.promise);
    changes.hide();
    measured.resolve({ visible: true, height: 300 });
    await shown;
    expect(seen).toEqual([{ visible: false, height: 0 }]);
  });

  test('only the newest of two overlapping shows is emitted', async () => {
    const seen: KeyboardChange[] = [];
    const changes = createKeyboardChanges(c => seen.push(c));
    const first = deferred<KeyboardChange>();
    const second = deferred<KeyboardChange>();
    const a = changes.show(() => first.promise);
    const b = changes.show(() => second.promise);
    second.resolve({ visible: true, height: 280 });
    first.resolve({ visible: true, height: 300 });
    await Promise.all([a, b]);
    expect(seen).toEqual([{ visible: true, height: 280 }]);
  });
});
