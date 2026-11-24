import { unescapeIcalText, unfoldIcalLines } from './providers/caldav';

export interface CalendarEventPerson {
  email?: string;
  name?: string;
  /** accepted | declined | tentative | needsAction, lower-cased */
  responseStatus?: string;
  organizer?: boolean;
}

export interface CalendarEventMetadata {
  /** Where to join the meeting: Meet, Zoom, Teams, ... */
  meetingUrl: string | null;
  /** The event in the provider's own calendar UI. */
  eventUrl: string | null;
  organizer: CalendarEventPerson | null;
  attendees: CalendarEventPerson[];
}

const EMPTY: CalendarEventMetadata = {
  meetingUrl: null,
  eventUrl: null,
  organizer: null,
  attendees: [],
};

// Hosts whose links are video calls. Matched against links found in the
// location and description when the provider gives no conference field
// (a Zoom link pasted into a Google event, most CalDAV servers).
const MEETING_HOSTS = [
  /(^|\.)meet\.google\.com$/,
  /(^|\.)zoom\.us$/,
  /(^|\.)zoomgov\.com$/,
  /(^|\.)teams\.microsoft\.com$/,
  /(^|\.)teams\.live\.com$/,
  /(^|\.)webex\.com$/,
  /(^|\.)whereby\.com$/,
  /(^|\.)gotomeeting\.com$/,
  /(^|\.)meet\.goto\.com$/,
  /(^|\.)bluejeans\.com$/,
  /(^|\.)chime\.aws$/,
  /(^|\.)meet\.jit\.si$/,
  /(^|\.)around\.co$/,
  /(^|\.)facetime\.apple\.com$/,
];

const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;

const isHttpUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

const isMeetingUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return MEETING_HOSTS.some(re => re.test(host));
  } catch {
    return false;
  }
};

/** The first video-call link in free text (location, description). */
export const findMeetingUrl = (
  ...texts: Array<string | null | undefined>
): string | null => {
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(URL_RE)) {
      // A trailing full stop or comma belongs to the sentence, not the link.
      const url = match[0].replace(/[.,;:!?]+$/, '');
      if (isMeetingUrl(url)) return url;
    }
  }
  return null;
};

const str = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// ---------------------------------------------------------------- Google

type GooglePerson = {
  email?: unknown;
  displayName?: unknown;
  responseStatus?: unknown;
  organizer?: unknown;
  resource?: unknown;
};

const googlePerson = (value: unknown): CalendarEventPerson | null => {
  if (!value || typeof value !== 'object') return null;
  const person = value as GooglePerson;
  const email = str(person.email);
  const name = str(person.displayName);
  if (!email && !name) return null;
  return {
    email,
    name,
    responseStatus: str(person.responseStatus)?.toLowerCase(),
    organizer: person.organizer === true || undefined,
  };
};

const fromGoogle = (
  raw: Record<string, unknown>,
  text: { location?: string | null; description?: string | null }
): CalendarEventMetadata => {
  let meetingUrl: string | null = null;
  const conference = raw.conferenceData as
    | { entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }> }
    | undefined;
  const video = conference?.entryPoints?.find(
    entry => entry.entryPointType === 'video' && isHttpUrl(entry.uri)
  );
  if (video) meetingUrl = video.uri as string;
  else if (isHttpUrl(raw.hangoutLink)) meetingUrl = raw.hangoutLink;
  else meetingUrl = findMeetingUrl(text.location, text.description);

  const attendees = Array.isArray(raw.attendees)
    ? raw.attendees
        // Rooms and equipment are booked as attendees; they are not people.
        .filter(a => !(a as GooglePerson | null)?.resource)
        .map(googlePerson)
        .filter((p): p is CalendarEventPerson => !!p)
    : [];

  const organizer = googlePerson(raw.organizer);
  if (organizer) organizer.organizer = true;

  return {
    meetingUrl,
    eventUrl: isHttpUrl(raw.htmlLink) ? raw.htmlLink : null,
    organizer,
    attendees,
  };
};

// ---------------------------------------------------------------- CalDAV

type IcalProp = { name: string; params: Record<string, string>; value: string };

/** The properties of the first VEVENT in an iCalendar resource. */
const firstVEventProps = (ical: string): IcalProp[] => {
  const props: IcalProp[] = [];
  let inside = false;
  let depth = 0;
  for (const line of unfoldIcalLines(ical)) {
    if (line === 'BEGIN:VEVENT') {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (line === 'END:VEVENT') break;
    // Skip nested components such as VALARM.
    if (line.startsWith('BEGIN:')) depth++;
    if (line.startsWith('END:')) {
      depth--;
      continue;
    }
    if (depth > 0) continue;

    const colon = indexOfUnquoted(line, ':');
    if (colon === -1) continue;
    const [name, ...paramParts] = splitUnquoted(line.slice(0, colon), ';');
    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, '');
    }
    props.push({
      name: name.toUpperCase(),
      params,
      value: line.slice(colon + 1),
    });
  }
  return props;
};

// Parameter values may be quoted and contain ':' or ';' (CN="Doe; Jane").
const indexOfUnquoted = (text: string, char: string) => {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === char && !quoted) return i;
  }
  return -1;
};

const splitUnquoted = (text: string, char: string) => {
  const parts: string[] = [];
  let rest = text;
  for (let i = indexOfUnquoted(rest, char); i !== -1; ) {
    parts.push(rest.slice(0, i));
    rest = rest.slice(i + 1);
    i = indexOfUnquoted(rest, char);
  }
  parts.push(rest);
  return parts;
};

const icalPerson = (prop: IcalProp): CalendarEventPerson | null => {
  const email = str(prop.value.replace(/^mailto:/i, ''));
  const name = str(prop.params.CN);
  if (!email && !name) return null;
  return {
    email,
    name,
    responseStatus: str(prop.params.PARTSTAT)
      ?.toLowerCase()
      .replace('needs-action', 'needsAction'),
  };
};

// Conference links as Google, Microsoft and RFC 7986 put them in iCalendar.
const ICAL_MEETING_PROPS = [
  'CONFERENCE',
  'X-GOOGLE-CONFERENCE',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL',
  'X-MICROSOFT-ONLINEMEETINGCONFLINK',
  'X-MICROSOFT-ONLINEMEETINGEXTERNALLINK',
];

const fromIcal = (
  ical: string,
  text: { location?: string | null; description?: string | null }
): CalendarEventMetadata => {
  const props = firstVEventProps(ical);
  const get = (name: string) => props.find(p => p.name === name);

  let meetingUrl: string | null = null;
  for (const name of ICAL_MEETING_PROPS) {
    const value = get(name)?.value;
    if (isHttpUrl(value)) {
      meetingUrl = value;
      break;
    }
  }
  const url = get('URL')?.value;
  if (!meetingUrl && url && isHttpUrl(url) && isMeetingUrl(url)) {
    meetingUrl = url;
  }
  meetingUrl ??= findMeetingUrl(
    text.location ?? unescapeIcalText(get('LOCATION')?.value ?? ''),
    text.description ?? unescapeIcalText(get('DESCRIPTION')?.value ?? '')
  );

  const organizerProp = get('ORGANIZER');
  const organizer = organizerProp ? icalPerson(organizerProp) : null;
  if (organizer) organizer.organizer = true;

  const attendees = props
    .filter(p => p.name === 'ATTENDEE')
    .filter(p => !['ROOM', 'RESOURCE'].includes(p.params.CUTYPE ?? ''))
    .map(p => {
      const person = icalPerson(p);
      if (person && organizer?.email && person.email === organizer.email) {
        person.organizer = true;
      }
      return person;
    })
    .filter((p): p is CalendarEventPerson => !!p);

  return {
    meetingUrl,
    eventUrl: url && isHttpUrl(url) && url !== meetingUrl ? url : null,
    organizer,
    attendees,
  };
};

/**
 * Meeting link, attendees and the like, read from the provider's own copy of
 * the event (`raw`: a Google event resource, or `{ ical }` from CalDAV).
 *
 * Read at query time rather than stored in columns, so events synced before
 * this existed have it too and nothing needs a migration or a resync.
 */
export const extractEventMetadata = (event: {
  raw: unknown;
  location?: string | null;
  description?: string | null;
}): CalendarEventMetadata => {
  const raw = event.raw;
  const text = { location: event.location, description: event.description };
  if (!raw || typeof raw !== 'object') {
    return {
      ...EMPTY,
      meetingUrl: findMeetingUrl(text.location, text.description),
    };
  }
  const record = raw as Record<string, unknown>;
  try {
    if (typeof record.ical === 'string') return fromIcal(record.ical, text);
    return fromGoogle(record, text);
  } catch {
    // Malformed provider data must not take the whole day's events down.
    return {
      ...EMPTY,
      meetingUrl: findMeetingUrl(text.location, text.description),
    };
  }
};
