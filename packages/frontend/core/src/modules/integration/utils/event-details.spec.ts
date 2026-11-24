import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { buildEventDetails, descriptionToParagraphs } from './event-details';

const labels = {
  when: 'When',
  where: 'Where',
  meeting: 'Meeting link',
  organizer: 'Organizer',
  attendees: 'Attendees',
  openInCalendar: 'Open in calendar',
  allDay: 'All day',
};

const base = {
  startAt: dayjs('2026-11-23T09:00:00'),
  endAt: dayjs('2026-11-23T09:30:00'),
  allDay: false,
};

describe('buildEventDetails', () => {
  it('lists time, place, link, people and calendar link in order', () => {
    const details = buildEventDetails(
      {
        ...base,
        location: 'Room 4',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        eventUrl: 'https://calendar.google.com/event?eid=1',
        organizer: { name: 'Jane', email: 'jane@example.com' },
        attendees: [
          { name: 'Jane', email: 'jane@example.com', organizer: true },
          { email: 'bob@example.com' },
        ],
        description: 'Agenda<br>1. Status',
      },
      labels
    );
    expect(details.lines).toEqual([
      { label: 'When', text: 'Mon 23 Nov 2026, 09:00 – 09:30' },
      { label: 'Where', text: 'Room 4' },
      {
        label: 'Meeting link',
        text: 'https://meet.google.com/abc-defg-hij',
        url: 'https://meet.google.com/abc-defg-hij',
      },
      { label: 'Organizer', text: 'Jane' },
      { label: 'Attendees', text: 'bob@example.com' },
      {
        label: 'Open in calendar',
        text: 'https://calendar.google.com/event?eid=1',
        url: 'https://calendar.google.com/event?eid=1',
      },
    ]);
    expect(details.description).toEqual(['Agenda', '1. Status']);
  });

  it('skips a location that is only the meeting link', () => {
    const url = 'https://zoom.us/j/1';
    const details = buildEventDetails(
      { ...base, location: url, meetingUrl: url },
      labels
    );
    expect(details.lines.map(l => l.label)).toEqual(['When', 'Meeting link']);
  });

  it('shows an all-day event by its day, not midnight', () => {
    const details = buildEventDetails(
      {
        startAt: dayjs('2026-11-23T00:00:00'),
        endAt: dayjs('2026-11-24T00:00:00'),
        allDay: true,
      },
      labels
    );
    expect(details.lines[0].text).toBe('Mon 23 Nov 2026 · All day');
  });
});

describe('descriptionToParagraphs', () => {
  it('keeps link targets and decodes entities from Google HTML', () => {
    expect(
      descriptionToParagraphs(
        '<p>Notes: <a href="https://docs.example.com/x">doc</a></p><p>Tom &amp; Jerry</p>'
      )
    ).toEqual(['Notes: doc (https://docs.example.com/x)', 'Tom & Jerry']);
  });
});
