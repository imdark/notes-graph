/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SwipeHelper } from './swipe-helper';

function touch(type: string, target: EventTarget, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [point],
  });
  target.dispatchEvent(event);
  return event;
}

/** Touch listeners currently on <body>, by type. */
function trackBodyListeners() {
  const live = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const add = document.body.addEventListener.bind(document.body);
  const remove = document.body.removeEventListener.bind(document.body);
  vi.spyOn(document.body, 'addEventListener').mockImplementation(
    (type, listener, options) => {
      if (listener) {
        if (!live.has(type)) live.set(type, new Set());
        live.get(type)?.add(listener);
      }
      add(type, listener, options);
    }
  );
  vi.spyOn(document.body, 'removeEventListener').mockImplementation(
    (type, listener, options) => {
      if (listener) live.get(type)?.delete(listener);
      remove(type, listener, options);
    }
  );
  return (type: string) => live.get(type)?.size ?? 0;
}

describe('SwipeHelper', () => {
  let trigger: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    trigger = document.createElement('div');
    outside = document.createElement('div');
    document.body.append(trigger, outside);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    trigger.remove();
    outside.remove();
  });

  test('a finished swipe leaves no listeners on <body>', () => {
    const count = trackBodyListeners();
    const helper = new SwipeHelper();
    const onSwipeEnd = vi.fn();
    helper.init(trigger, { preventScroll: true, onSwipeEnd });

    touch('touchstart', trigger, 0, 0);
    expect(count('touchmove')).toBe(1);
    touch('touchmove', trigger, 0, 40);
    touch('touchend', trigger);

    expect(onSwipeEnd).toHaveBeenCalledOnce();
    expect(count('touchmove')).toBe(0);
    expect(count('touchend')).toBe(0);
    expect(count('touchcancel')).toBe(0);
    helper.destroy();
  });

  test('a cancelled swipe stops cancelling drags elsewhere on the page', () => {
    const count = trackBodyListeners();
    const helper = new SwipeHelper();
    const onSwipeEnd = vi.fn();
    const onTap = vi.fn();
    helper.init(trigger, { preventScroll: true, onSwipeEnd, onTap });

    touch('touchstart', trigger, 0, 0);
    touch('touchmove', trigger, 0, 40);
    touch('touchcancel', trigger);

    // The gesture didn't finish: no tap or swipe-end.
    expect(onTap).not.toHaveBeenCalled();
    expect(onSwipeEnd).not.toHaveBeenCalled();
    expect(count('touchmove')).toBe(0);

    // A later drag that starts outside the helper's element can scroll.
    const move = touch('touchmove', outside, 0, 80);
    expect(move.defaultPrevented).toBe(false);
    helper.destroy();
  });

  test('a touchstart without a touchend before it does not leak the old listeners', () => {
    const count = trackBodyListeners();
    const helper = new SwipeHelper();
    helper.init(trigger, { preventScroll: true });

    // Two touchstarts in a row (the first touch's end never reached <body>).
    touch('touchstart', trigger, 0, 0);
    touch('touchstart', trigger, 0, 0);
    expect(count('touchmove')).toBe(1);
    expect(count('touchend')).toBe(1);

    touch('touchend', trigger);
    expect(count('touchmove')).toBe(0);
    expect(count('touchend')).toBe(0);

    const move = touch('touchmove', outside, 0, 80);
    expect(move.defaultPrevented).toBe(false);
    helper.destroy();
  });

  test('during a swipe, moves are still cancelled when preventScroll is set', () => {
    const helper = new SwipeHelper();
    helper.init(trigger, { preventScroll: true });
    touch('touchstart', trigger, 0, 0);
    const move = touch('touchmove', trigger, 0, 40);
    expect(move.defaultPrevented).toBe(true);
    touch('touchend', trigger);
    helper.destroy();
  });
});
