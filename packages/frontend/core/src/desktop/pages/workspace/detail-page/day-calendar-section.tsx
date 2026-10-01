import { IntegrationService } from '@notesgraph/core/modules/integration';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import dayjs from 'dayjs';
import { useEffect, useMemo } from 'react';

import * as styles from './day-calendar-section.css';

/**
 * One day's calendar events, shown on a journal page above the written notes.
 *
 * Read-only on purpose: events are mirrored from Google/CalDAV, and nothing
 * here writes back. Until there is a defined answer for what editing a synced
 * event should do upstream, showing them is the honest half of the feature.
 *
 * Takes a date rather than assuming today, so it works on whichever journal
 * day is open - past days included.
 */
export const DayCalendarSection = ({ date }: { date: string }) => {
  const t = useI18n();
  const calendar = useService(IntegrationService).calendar;

  const day = useMemo(() => dayjs(date), [date]);
  const events = useLiveData(
    useMemo(() => calendar.eventsByDate$(day), [calendar, day])
  );

  useEffect(() => {
    // Nothing else pulls events for a given day, so the widget asks. An
    // AbortController keeps a fast flick through journal days from landing
    // yesterday's answer on today's page.
    const controller = new AbortController();
    calendar.revalidateEvents(day, controller.signal).catch(() => {
      // A calendar that is not connected, or a request that lost its race,
      // is not worth shouting about on a journal page - the section simply
      // stays empty.
    });
    return () => controller.abort();
  }, [calendar, day]);

  // Several calendars connected? Then say which one an event came from.
  const showCalendarName = useMemo(
    () => new Set(events.map(event => event.calendarName)).size > 1,
    [events]
  );

  // No events is the common case for most people on most days; an empty box
  // every morning would be worse than no box.
  if (events.length === 0) return null;

  return (
    <div className={styles.wrapper} data-testid="day-calendar-section">
      <div className={styles.section}>
        <div className={styles.header}>
          {t['com.notesgraph.integration.calendar.name']()}
          <span className={styles.count}>{events.length}</span>
        </div>
        {events.map(event => (
          <div key={event.id} className={styles.row}>
            <span
              className={styles.dot}
              style={
                event.calendarColor
                  ? { background: event.calendarColor }
                  : undefined
              }
            />
            <span className={styles.time}>
              {event.allDay
                ? t['com.notesgraph.integration.calendar.all-day']()
                : `${event.startAt.format('HH:mm')} – ${event.endAt.format('HH:mm')}`}
            </span>
            <span className={styles.title}>
              {event.title || t['Untitled']()}
            </span>
            {showCalendarName && event.calendarName ? (
              <span className={styles.calendarName}>{event.calendarName}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
