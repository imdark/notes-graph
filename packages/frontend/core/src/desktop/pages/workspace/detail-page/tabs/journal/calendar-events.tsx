import { FullDayIcon, PeriodIcon, PlusIcon } from '@blocksuite/icons/rc';
import { Loading, toast, Tooltip } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { type DocRecord, DocsService } from '@notesgraph/core/modules/doc';
import {
  type CalendarEvent,
  CalendarEventNoteService,
  IntegrationService,
} from '@notesgraph/core/modules/integration';
import { JournalService } from '@notesgraph/core/modules/journal';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { GuardService } from '@notesgraph/core/modules/permissions';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { cssVarV2 } from '@toeverything/theme/v2';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';

import * as styles from './calendar-events.css';

function formatTime(start?: Dayjs, end?: Dayjs) {
  if (!start || !end) return '';
  const from = start.format('HH:mm');
  const to = end.format('HH:mm');
  return from === to ? from : `${from} - ${to}`;
}

export const CalendarEvents = ({ date }: { date: Dayjs }) => {
  const calendar = useService(IntegrationService).calendar;
  const events = useLiveData(
    useMemo(() => calendar.eventsByDate$(date), [calendar, date])
  );

  return (
    <ul className={styles.list}>
      {events.map(event => (
        <CalendarEventRenderer key={event.id} event={event} />
      ))}
    </ul>
  );
};

const CalendarEventRenderer = ({ event }: { event: CalendarEvent }) => {
  const t = useI18n();
  const { title, startAt, endAt, allDay, date, calendarName, calendarColor } =
    event;
  const [loading, setLoading] = useState(false);
  const docsService = useService(DocsService);
  const guardService = useService(GuardService);
  const journalService = useService(JournalService);
  const notes = useService(CalendarEventNoteService);
  const peekView = useService(PeekViewService).peekView;
  const name = calendarName || t['Untitled']();
  const color = calendarColor || cssVarV2.button.primary;
  const eventTitle = title || t['Untitled']();

  const handleClick = useAsyncCallback(async () => {
    if (loading) return;
    const docs = journalService.journalsByDate$(
      date.format('YYYY-MM-DD')
    ).value;
    if (docs.length === 0) {
      toast(
        t['com.notesgraph.integration.calendar.no-journal']({
          date: date.format('YYYY-MM-DD'),
        })
      );
      return;
    }

    setLoading(true);

    try {
      // An event has one note, shared with the journal page's calendar
      // section: reuse it if it exists, and only link a freshly made one,
      // so clicking twice does not leave two links to the same note.
      const isNew = !notes.notesByEventId$.value.has(event.externalEventId);
      let note: DocRecord | null = null;
      for (const doc of docs) {
        const canEdit = await guardService.can('Doc_Update', doc.id);
        if (!canEdit) {
          toast(t['com.notesgraph.no-permission']());
          continue;
        }

        note ??= notes.ensureNote(event, t['Untitled']());
        if (isNew) {
          await docsService.addLinkedDoc(doc.id, note.id);
        }
      }
      if (note) {
        peekView.open({ docRef: { docId: note.id } }).catch(console.error);
      }
      track.doc.sidepanel.journal.createCalendarDocEvent();
    } finally {
      setLoading(false);
    }
  }, [
    date,
    docsService,
    event,
    guardService,
    journalService,
    loading,
    notes,
    peekView,
    t,
  ]);

  return (
    <li
      style={assignInlineVars({
        [styles.primaryColor]: color,
      })}
      className={styles.event}
      data-all-day={allDay}
      onClick={handleClick}
    >
      <Tooltip
        align="start"
        side="top"
        options={{
          className: styles.nameTooltip,
          sideOffset: 12,
          alignOffset: -4,
        }}
        content={
          <div className={styles.nameTooltipContent}>
            <div className={styles.nameTooltipIcon} style={{ color }} />
            <div className={styles.nameTooltipName}>{name}</div>
          </div>
        }
      >
        <div className={styles.eventIcon}>
          {allDay ? <FullDayIcon /> : <PeriodIcon />}
        </div>
      </Tooltip>
      <div className={styles.eventTitle}>{eventTitle}</div>
      {loading ? (
        <Loading />
      ) : (
        <div className={styles.eventCaption}>
          <span className={styles.eventTime}>
            {allDay
              ? t['com.notesgraph.integration.calendar.all-day']()
              : formatTime(startAt, endAt)}
          </span>
          <span className={styles.eventNewDoc}>
            <PlusIcon style={{ fontSize: 18 }} />
            {t['com.notesgraph.integration.calendar.new-doc']()}
          </span>
        </div>
      )}
    </li>
  );
};
