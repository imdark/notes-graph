/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

const focusTextModel = vi.hoisted(() => vi.fn());
vi.mock('@blocksuite/notesgraph/rich-text', async importOriginal => ({
  ...(await importOriginal<object>()),
  focusTextModel,
}));

import { AgentAssignWidget, openAssignToAgentMenuOn } from './assign-widget';

const pillWidget = (opened: boolean) => {
  // Not rendered: only its pill menu is under test.
  const widget: AgentAssignWidget = Object.create(AgentAssignWidget.prototype);
  widget.openMenu = vi.fn(async () => opened);
  return widget;
};

/** An editor whose line renders its widget after `renderAfter` looks. */
const fakeStd = (widget: AgentAssignWidget | null, renderAfter = 0) => {
  let looks = 0;
  return {
    view: {
      getWidget: vi.fn(() => (looks++ >= renderAfter ? widget : null)),
      getBlock: vi.fn(() => null),
    },
    store: {
      getBlock: vi.fn(() => ({ model: { text: { length: 12 } } })),
    },
  } as any;
};

afterEach(() => {
  focusTextModel.mockClear();
  vi.useRealTimers();
});

describe('openAssignToAgentMenuOn', () => {
  test("puts the caret at the line's end and opens its pill menu", async () => {
    const widget = pillWidget(true);
    const std = fakeStd(widget);

    await expect(openAssignToAgentMenuOn(std, 'b1')).resolves.toBe(true);
    expect(std.view.getWidget).toHaveBeenCalledWith(
      'notesgraph-agent-assign-widget',
      'b1'
    );
    expect(focusTextModel).toHaveBeenCalledWith(std, 'b1', 12);
    expect(widget.openMenu).toHaveBeenCalledOnce();
  });

  test('waits for a line that has not synced in or rendered yet', async () => {
    vi.useFakeTimers();
    const widget = pillWidget(true);
    const opening = openAssignToAgentMenuOn(fakeStd(widget, 3), 'b1');

    await vi.advanceTimersByTimeAsync(1000);
    await expect(opening).resolves.toBe(true);
    expect(widget.openMenu).toHaveBeenCalledOnce();
  });

  test('gives up when the line never shows up', async () => {
    vi.useFakeTimers();
    const opening = openAssignToAgentMenuOn(fakeStd(null), 'b1');

    await vi.advanceTimersByTimeAsync(6000);
    await expect(opening).resolves.toBe(false);
    expect(focusTextModel).not.toHaveBeenCalled();
  });

  test('stops waiting once the note is left', async () => {
    vi.useFakeTimers();
    const widget = pillWidget(true);
    const controller = new AbortController();
    const opening = openAssignToAgentMenuOn(
      fakeStd(widget, 5),
      'b1',
      controller.signal
    );

    await vi.advanceTimersByTimeAsync(150);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(opening).resolves.toBe(false);
    expect(widget.openMenu).not.toHaveBeenCalled();
  });
});
