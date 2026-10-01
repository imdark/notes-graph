import { LiveData, Service } from '@notesgraph/infra';

import type { DocRecord, DocsService } from '../../doc';
import type { CalendarEvent } from '../type';

/**
 * Notes attached to synced calendar events.
 *
 * A note is an ordinary doc carrying a `calendarEvent` property, so it syncs,
 * searches and links like any other doc. It is NotesGraph-only: the calendar
 * is mirrored read-only and nothing here writes back to Google/CalDAV.
 *
 * One note per event: asking again for an event that already has one returns
 * that note rather than piling up duplicates.
 */
export class CalendarEventNoteService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  /** externalEventId -> the (non-trashed) doc holding that event's note */
  readonly notesByEventId$ = LiveData.computed(get => {
    const notes = new Map<string, DocRecord>();
    for (const doc of get(this.docsService.list.docs$)) {
      const ref = get(doc.properties$.selector(p => p.calendarEvent));
      if (!ref?.externalEventId) continue;
      if (get(doc.meta$.selector(m => m.trash))) continue;
      notes.set(ref.externalEventId, doc);
    }
    return notes;
  });

  note$(externalEventId: string) {
    return this.notesByEventId$.selector(
      notes => notes.get(externalEventId) ?? null
    );
  }

  /** The event's note, created (titled after the event) if it has none yet. */
  ensureNote(
    event: Pick<CalendarEvent, 'externalEventId' | 'title' | 'date'>,
    untitled: string
  ) {
    const existing = this.notesByEventId$.value.get(event.externalEventId);
    if (existing) return existing;

    const doc = this.docsService.createDoc({
      title: event.title || untitled,
    });
    doc.setProperty('calendarEvent', {
      externalEventId: event.externalEventId,
      date: event.date.format('YYYY-MM-DD'),
    });
    return doc;
  }
}
