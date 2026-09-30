/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IntegrationServiceToken = vi.hoisted(
  () => class IntegrationService {}
);

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
}));

vi.mock('@notesgraph/core/modules/integration', () => ({
  IntegrationService: IntegrationServiceToken,
}));

vi.mock('@notesgraph/infra', () => ({
  useService: () => ({
    calendar: {
      eventsByDate$: () => state.events,
      revalidateEvents: (date: { format: (f: string) => string }) => {
        state.revalidated.push(date.format('YYYY-MM-DD'));
        return Promise.resolve([]);
      },
    },
  }),
  // The component only reads the signal the stub above returns.
  useLiveData: (value: unknown) => value,
}));

vi.mock('@notesgraph/i18n', () => {
  const messages: Record<string, string> = {
    'com.notesgraph.integration.calendar.name': 'Calendar',
    'com.notesgraph.integration.calendar.all-day': 'All day',
    Untitled: 'Untitled',
  };
  return {
    useI18n: () =>
      new Proxy({} as Record<string, () => string>, {
        get: (_t, key: string) => () => messages[key] ?? key,
      }),
  };
});

const { DayCalendarSection } = await import(
  '../desktop/pages/workspace/detail-page/day-calendar-section'
);

const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  subscriptionId: 's1',
  title: 'Standup',
  startAt: dayjs('2026-09-29T09:00:00'),
  endAt: dayjs('2026-09-29T09:15:00'),
  allDay: false,
  date: dayjs('2026-09-29'),
  calendarName: 'Work',
  calendarColor: '#ff0000',
  ...over,
});

beforeEach(() => {
  state.events = [];
  state.revalidated = [];
});
afterEach(cleanup);

describe('DayCalendarSection', () => {
  it('renders nothing on a day with no events', () => {
    const { container } = render(<DayCalendarSection date="2026-09-29" />);
    // An empty box on every journal page would be worse than no box.
    expect(container.firstChild).toBeNull();
  });

  it('lists an event with its time range', () => {
    state.events = [event()];
    render(<DayCalendarSection date="2026-09-29" />);

    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByText(/09:00 – 09:15/)).toBeTruthy();
  });

  it('labels an all-day event instead of showing 00:00', () => {
    state.events = [event({ allDay: true })];
    render(<DayCalendarSection date="2026-09-29" />);

    expect(screen.getByText('All day')).toBeTruthy();
    expect(screen.queryByText(/00:00/)).toBeNull();
  });

  it('falls back to Untitled for an event with no title', () => {
    state.events = [event({ title: '' })];
    render(<DayCalendarSection date="2026-09-29" />);

    expect(screen.getByText('Untitled')).toBeTruthy();
  });

  it('names the calendar only when more than one is in play', () => {
    state.events = [event(), event({ id: 'e2', title: 'Retro' })];
    const { unmount } = render(<DayCalendarSection date="2026-09-29" />);
    // Both from "Work": naming it on every row is noise.
    expect(screen.queryByText('Work')).toBeNull();
    unmount();

    state.events = [
      event(),
      event({ id: 'e2', title: 'Dentist', calendarName: 'Personal' }),
    ];
    render(<DayCalendarSection date="2026-09-29" />);
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.getByText('Personal')).toBeTruthy();
  });

  it('asks for the day it was given, not today', () => {
    state.events = [event()];
    render(<DayCalendarSection date="2026-09-29" />);

    // "today and other days": the widget is driven by its date prop, so it
    // works on whichever journal day is open.
    expect(state.revalidated).toEqual(['2026-09-29']);
  });
});
