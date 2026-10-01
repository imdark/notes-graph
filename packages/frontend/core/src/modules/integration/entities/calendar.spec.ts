import { Framework } from '@notesgraph/infra';
import dayjs from 'dayjs';
import { describe, expect, test, vi } from 'vitest';

import { CalendarStore } from '../store/calendar';
import { CalendarIntegration } from './calendar';

const event = {
  id: 'e1',
  subscriptionId: 's1',
  externalEventId: 'g1',
  recurrenceId: null,
  status: null,
  title: 'Standup',
  description: null,
  location: null,
  startAtUtc: '2026-09-29T09:00:00.000Z',
  endAtUtc: '2026-09-29T09:15:00.000Z',
  originalTimezone: null,
  allDay: false,
};

function createStore(overrides: Partial<Record<keyof CalendarStore, unknown>>) {
  return {
    fetchAccounts: vi.fn().mockResolvedValue([
      {
        id: 'a1',
        calendars: [{ id: 's1', displayName: 'Work', color: '#f00' }],
      },
    ]),
    fetchWorkspaceCalendars: vi
      .fn()
      .mockResolvedValue([{ id: 'wc1', items: [{ subscriptionId: 's1' }] }]),
    fetchEvents: vi.fn().mockResolvedValue([event]),
    ...overrides,
  } as unknown as CalendarStore;
}

function createEntity(store: CalendarStore) {
  const framework = new Framework();
  framework
    .store(CalendarStore, store)
    .entity(CalendarIntegration, [CalendarStore]);
  return framework.provider().createEntity(CalendarIntegration);
}

describe('CalendarIntegration', () => {
  test('a fresh page load finds events without the settings panel open', async () => {
    // Nothing has loaded the workspace's calendars - the state after a
    // refresh. Asking for a day's events must load them, not return nothing.
    const store = createStore({});
    const calendar = createEntity(store);
    const day = dayjs(event.startAtUtc);

    await calendar.revalidateEvents(day);

    expect(store.fetchEvents).toHaveBeenCalledWith(
      'wc1',
      expect.any(String),
      expect.any(String),
      undefined
    );
    const events = calendar.eventsByDate$(day).value;
    expect(events.map(e => e.title)).toEqual(['Standup']);
    // ...and named/coloured, which needs the account calendars too
    expect(events[0].calendarName).toBe('Work');
  });

  test('loads the calendars once, not on every day asked for', async () => {
    const store = createStore({});
    const calendar = createEntity(store);

    await Promise.all([
      calendar.revalidateEvents(dayjs('2026-09-29')),
      calendar.revalidateEvents(dayjs('2026-09-30')),
    ]);
    await calendar.revalidateEvents(dayjs('2026-10-01'));

    expect(store.fetchWorkspaceCalendars).toHaveBeenCalledTimes(1);
    expect(store.fetchAccounts).toHaveBeenCalledTimes(1);
  });

  test('still shows events when the account calendars cannot be read', async () => {
    const store = createStore({
      fetchAccounts: vi.fn().mockRejectedValue(new Error('denied')),
    });
    const calendar = createEntity(store);
    const day = dayjs(event.startAtUtc);

    await calendar.revalidateEvents(day);

    expect(calendar.eventsByDate$(day).value).toHaveLength(1);
  });

  test('retries the calendar load after a failure', async () => {
    const store = createStore({
      fetchWorkspaceCalendars: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([{ id: 'wc1', items: [] }]),
    });
    const calendar = createEntity(store);
    const day = dayjs(event.startAtUtc);

    await expect(calendar.revalidateEvents(day)).rejects.toThrow('offline');
    await calendar.revalidateEvents(day);

    expect(store.fetchWorkspaceCalendars).toHaveBeenCalledTimes(2);
    expect(store.fetchEvents).toHaveBeenCalledTimes(1);
  });
});
