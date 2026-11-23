import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';

import { FeatureFlagService } from '../../feature-flag';
import type { CalendarEventDetailLabels } from '../utils/event-details';

/**
 * Labels for the details a new event note starts with, or undefined while
 * the enable_calendar_event_details flag is off (the note then starts empty).
 */
export const useCalendarEventDetailLabels = ():
  | CalendarEventDetailLabels
  | undefined => {
  const t = useI18n();
  const enabled = useLiveData(
    useService(FeatureFlagService).flags.enable_calendar_event_details.$
  );
  return useMemo(
    () =>
      enabled
        ? {
            when: t['com.notesgraph.integration.calendar.detail.when'](),
            where: t['com.notesgraph.integration.calendar.detail.where'](),
            meeting: t['com.notesgraph.integration.calendar.detail.meeting'](),
            organizer:
              t['com.notesgraph.integration.calendar.detail.organizer'](),
            attendees:
              t['com.notesgraph.integration.calendar.detail.attendees'](),
            openInCalendar:
              t[
                'com.notesgraph.integration.calendar.detail.open-in-calendar'
              ](),
            allDay: t['com.notesgraph.integration.calendar.all-day'](),
          }
        : undefined,
    [enabled, t]
  );
};
