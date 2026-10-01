/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tokens = vi.hoisted(() => ({
  IntegrationService: class IntegrationService {},
  CalendarEventNoteService: class CalendarEventNoteService {},
  PeekViewService: class PeekViewService {},
}));

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
  // externalEventId -> note doc id
  notes: new Map<string, string>(),
  created: [] as string[],
  peeked: [] as string[],
}));

vi.mock('@notesgraph/core/modules/integration', () => ({
  IntegrationService: tokens.IntegrationService,
  CalendarEventNoteService: tokens.CalendarEventNoteService,
}));

vi.mock('@notesgraph/core/modules/peek-view', () => ({
  PeekViewService: tokens.PeekViewService,
}));

vi.mock('@notesgraph/infra', () => ({
  useService: (token: unknown) => {
    if (token === tokens.CalendarEventNoteService) {
      return {
        note$: (id: string) =>
          state.notes.has(id) ? { id: state.notes.get(id) } : null,
        ensureNote: (event: { externalEventId: string }) => {
          let id = state.notes.get(event.externalEventId);
          if (!id) {
            id = `note-${event.externalEventId}`;
            state.notes.set(event.externalEventId, id);
            state.created.push(id);
          }
          return { id };
        },
      };
    }
    if (token === tokens.PeekViewService) {
      return {
        peekView: {
          open: ({ docRef }: { docRef: { docId: string } }) => {
            state.peeked.push(docRef.docId);
            return Promise.resolve();
          },
        },
      };
    }
    return {
      calendar: {
        eventsByDate$: () => state.events,
        revalidateEvents: (date: { format: (f: string) => string }) => {
          state.revalidated.push(date.format('YYYY-MM-DD'));
          return Promise.resolve([]);
        },
      },
    };
  },
  // The component only reads the signal the stub above returns.
  useLiveData: (value: unknown) => value,
}));

vi.mock('@notesgraph/i18n', () => {
  const messages: Record<string, string> = {
    'com.notesgraph.integration.calendar.name': 'Calendar',
    'com.notesgraph.integration.calendar.all-day': 'All day',
    'com.notesgraph.integration.calendar.add-note': 'Add note',
    'com.notesgraph.integration.calendar.open-note': 'Open note',
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
  externalEventId: 'g1',
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
  state.notes = new Map();
  state.created = [];
  state.peeked = [];
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

  it('adds a note to an event without one, and opens it', () => {
    state.events = [event()];
    render(<DayCalendarSection date="2026-09-29" />);

    fireEvent.click(screen.getByRole('button', { name: /Standup.*Add note/ }));

    expect(state.created).toEqual(['note-g1']);
    expect(state.peeked).toEqual(['note-g1']);
  });

  it("opens an event's existing note instead of making another", () => {
    state.events = [event()];
    state.notes.set('g1', 'existing');
    render(<DayCalendarSection date="2026-09-29" />);

    fireEvent.click(screen.getByRole('button', { name: /Standup.*Open note/ }));

    expect(state.created).toEqual([]);
    expect(state.peeked).toEqual(['existing']);
  });
});
