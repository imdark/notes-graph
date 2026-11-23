import test from 'ava';

import { extractEventMetadata, findMeetingUrl } from '../event-metadata';

test('google: conference video entry wins over hangoutLink', t => {
  const meta = extractEventMetadata({
    raw: {
      hangoutLink: 'https://meet.google.com/old-link',
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+1-555-0100' },
          {
            entryPointType: 'video',
            uri: 'https://meet.google.com/abc-defg-hij',
          },
        ],
      },
      htmlLink: 'https://www.google.com/calendar/event?eid=xyz',
      organizer: { email: 'boss@example.com', displayName: 'Boss' },
      attendees: [
        { email: 'me@example.com', responseStatus: 'accepted', self: true },
        { email: 'room@resource.calendar.google.com', resource: true },
        {
          email: 'boss@example.com',
          displayName: 'Boss',
          organizer: true,
          responseStatus: 'accepted',
        },
      ],
    },
  });
  t.is(meta.meetingUrl, 'https://meet.google.com/abc-defg-hij');
  t.is(meta.eventUrl, 'https://www.google.com/calendar/event?eid=xyz');
  t.deepEqual(meta.organizer, {
    email: 'boss@example.com',
    name: 'Boss',
    responseStatus: undefined,
    organizer: true,
  });
  t.deepEqual(
    meta.attendees.map(a => a.email),
    ['me@example.com', 'boss@example.com']
  );
  t.is(meta.attendees[1].organizer, true);
});

test('google: falls back to a Zoom link in the location', t => {
  const meta = extractEventMetadata({
    raw: { id: 'e1' },
    location: 'https://us02web.zoom.us/j/123456789?pwd=abc',
    description: 'See https://example.com/agenda',
  });
  t.is(meta.meetingUrl, 'https://us02web.zoom.us/j/123456789?pwd=abc');
  t.deepEqual(meta.attendees, []);
});

test('caldav: reads conference props, organizer and attendees from iCal', t => {
  const ical = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:Sync',
    'ORGANIZER;CN="Doe; Jane":mailto:jane@example.com',
    'ATTENDEE;CN=Jane;PARTSTAT=ACCEPTED:mailto:jane@example.com',
    'ATTENDEE;CN=Bob;PARTSTAT=NEEDS-ACTION:mailto:bob@example.com',
    'ATTENDEE;CUTYPE=ROOM;CN=Room 1:mailto:room1@example.com',
    'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-jo',
    ' in/19%3ameeting',
    'URL:https://calendar.example.com/event/1',
    'BEGIN:VALARM',
    'ATTENDEE:mailto:alarm@example.com',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const meta = extractEventMetadata({ raw: { ical, href: '/1.ics' } });
  t.is(
    meta.meetingUrl,
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting'
  );
  t.is(meta.eventUrl, 'https://calendar.example.com/event/1');
  t.is(meta.organizer?.name, 'Doe; Jane');
  t.is(meta.organizer?.email, 'jane@example.com');
  t.deepEqual(
    meta.attendees.map(a => [a.email, a.responseStatus, a.organizer]),
    [
      ['jane@example.com', 'accepted', true],
      ['bob@example.com', 'needsAction', undefined],
    ]
  );
});

test('caldav: meeting link in the description when no conference prop', t => {
  const ical = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:2',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const meta = extractEventMetadata({
    raw: { ical },
    description: 'Join here: https://meet.google.com/abc-defg-hij.',
  });
  t.is(meta.meetingUrl, 'https://meet.google.com/abc-defg-hij');
  t.is(meta.eventUrl, null);
});

test('findMeetingUrl ignores links that are not calls', t => {
  t.is(findMeetingUrl('https://docs.google.com/doc/1', null), null);
  t.is(findMeetingUrl('https://evilzoom.us.example.com/j/1'), null);
});
