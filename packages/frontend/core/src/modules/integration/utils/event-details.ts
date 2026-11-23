import type { CalendarEvent, CalendarEventPerson } from '../type';

export type CalendarEventDetailLabels = {
  when: string;
  where: string;
  meeting: string;
  organizer: string;
  attendees: string;
  openInCalendar: string;
  allDay: string;
};

/** One "Label: value" line; `url` makes the value a link. */
export type CalendarEventDetailLine = {
  label: string;
  text: string;
  url?: string;
};

export type CalendarEventDetails = {
  lines: CalendarEventDetailLine[];
  /** The event's description as plain-text paragraphs. */
  description: string[];
};

type DetailSource = Pick<
  CalendarEvent,
  | 'startAt'
  | 'endAt'
  | 'allDay'
  | 'location'
  | 'meetingUrl'
  | 'eventUrl'
  | 'organizer'
  | 'attendees'
  | 'description'
>;

const personName = (person: CalendarEventPerson) =>
  person.name || person.email || '';

const formatWhen = (event: DetailSource, allDay: string) => {
  const { startAt, endAt } = event;
  if (event.allDay) {
    // An all-day event ends at midnight after its last day.
    const last = endAt.subtract(1, 'minute');
    const from = startAt.format('ddd D MMM YYYY');
    return last.isAfter(startAt, 'day')
      ? `${from} – ${last.format('ddd D MMM YYYY')} · ${allDay}`
      : `${from} · ${allDay}`;
  }
  const from = startAt.format('ddd D MMM YYYY, HH:mm');
  return endAt.isSame(startAt, 'day')
    ? `${from} – ${endAt.format('HH:mm')}`
    : `${from} – ${endAt.format('ddd D MMM YYYY, HH:mm')}`;
};

/**
 * Google sends descriptions as HTML (<br>, <a>, <b>); CalDAV as plain text.
 * Either way the note gets plain paragraphs, links kept as their URLs.
 */
export const descriptionToParagraphs = (description?: string): string[] => {
  if (!description) return [];
  const text = description
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href, label) => {
      const inner = String(label)
        .replace(/<[^>]+>/g, '')
        .trim();
      return !inner || inner === href ? href : `${inner} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
};

/** What a new event note starts with: the event's details, then its description. */
export const buildEventDetails = (
  event: DetailSource,
  labels: CalendarEventDetailLabels
): CalendarEventDetails => {
  const lines: CalendarEventDetailLine[] = [
    { label: labels.when, text: formatWhen(event, labels.allDay) },
  ];

  // A location that is just the meeting link would say the same thing twice.
  const location = event.location?.trim();
  if (location && location !== event.meetingUrl) {
    lines.push({ label: labels.where, text: location });
  }
  if (event.meetingUrl) {
    lines.push({
      label: labels.meeting,
      text: event.meetingUrl,
      url: event.meetingUrl,
    });
  }
  const organizer = event.organizer && personName(event.organizer);
  if (organizer) {
    lines.push({ label: labels.organizer, text: organizer });
  }
  const attendees = (event.attendees ?? [])
    .map(personName)
    .filter(name => name && name !== organizer);
  if (attendees.length > 0) {
    lines.push({ label: labels.attendees, text: attendees.join(', ') });
  }
  if (event.eventUrl) {
    lines.push({
      label: labels.openInCalendar,
      text: event.eventUrl,
      url: event.eventUrl,
    });
  }

  return { lines, description: descriptionToParagraphs(event.description) };
};
