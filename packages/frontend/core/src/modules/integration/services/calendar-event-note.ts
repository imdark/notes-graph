import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph/shared/types';
import type { DeltaInsert } from '@blocksuite/notesgraph/store';
import { Text } from '@blocksuite/notesgraph/store';
import { LiveData, Service } from '@notesgraph/infra';

import type { DocRecord, DocsService } from '../../doc';
import type { CalendarEvent } from '../type';
import {
  buildEventDetails,
  type CalendarEventDetailLabels,
  type CalendarEventDetails,
} from '../utils/event-details';

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

  /**
   * The event's note, created (titled after the event) if it has none yet.
   * Given `detailLabels`, a new note starts with the event's details (time,
   * place, meeting link, people, description). An existing note is left as
   * the user wrote it.
   */
  ensureNote(
    event: Pick<CalendarEvent, 'externalEventId' | 'title' | 'date'> &
      Partial<CalendarEvent>,
    untitled: string,
    detailLabels?: CalendarEventDetailLabels
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
    if (detailLabels && event.startAt && event.endAt) {
      const details = buildEventDetails(
        {
          ...event,
          startAt: event.startAt,
          endAt: event.endAt,
          allDay: !!event.allDay,
        },
        detailLabels
      );
      // The note opens straight away; the details land as soon as the doc
      // is ready, and a failure leaves an ordinary empty note.
      this.writeDetails(doc.id, details).catch(console.error);
    }
    return doc;
  }

  private async writeDetails(docId: string, details: CalendarEventDetails) {
    const { doc, release } = this.docsService.open(docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const [note] = store.getBlocksByFlavour('notesgraph:note');
      if (!note) return;
      for (const line of details.lines) {
        const deltas: DeltaInsert<NotesGraphTextAttributes>[] = [
          { insert: `${line.label}: `, attributes: { bold: true } },
          line.url
            ? { insert: line.text, attributes: { link: line.url } }
            : { insert: line.text },
        ];
        store.addBlock(
          'notesgraph:list' as never, // TODO(eyhn): fix type
          { type: 'bulleted', text: new Text(deltas) },
          note.id
        );
      }
      for (const paragraph of details.description) {
        store.addBlock(
          'notesgraph:paragraph' as never, // TODO(eyhn): fix type
          { text: new Text(paragraph) },
          note.id
        );
      }
    } finally {
      release();
    }
  }
}
