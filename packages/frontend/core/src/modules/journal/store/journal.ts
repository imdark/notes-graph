import { LiveData, Store } from '@notesgraph/infra';
import type { Observable } from 'rxjs';

import type { DocsService } from '../../doc';

function isJournalString(j?: string | false | null) {
  return j ? !!j?.match(/^\d{4}-\d{2}-\d{2}$/) : false;
}

export class JournalStore extends Store {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  /**
   * docId -> `journal` property, read from one indexed query over the doc
   * properties table.
   *
   * The lookups below used to `get(doc.properties$.selector(...))` for every
   * doc in the workspace. Each of those is a cold LiveData, so a single read
   * (e.g. "is there a journal for today?" on the create-journal button) set
   * up and tore down a Yjs observer plus a DB observer per doc, and every doc
   * change re-ran that for every subscriber — the whole UI froze for a
   * moment on large workspaces whenever a journal was created.
   */
  private readonly journalByDocId$ = LiveData.from(
    this.docsService.propertyValues$('journal'),
    new Map<string, string | undefined>()
  );

  private journalDocEntries(get: <L>(data: LiveData<L>) => L) {
    const docsMap = get(this.docsService.list.docsMap$);
    const journals = get(this.journalByDocId$);
    const entries: [string, string][] = [];
    for (const [docId, journal] of journals) {
      if (journal && isJournalString(journal) && docsMap.has(docId)) {
        entries.push([docId, journal]);
      }
    }
    return entries;
  }

  allJournalDates$ = LiveData.computed(get => {
    return new Set(this.journalDocEntries(get).map(([, date]) => date));
  });

  // Doc ids of every journal page (a doc whose `journal` property holds a valid
  // `YYYY-MM-DD` date). This is the first-class "journal page" identifier the
  // rest of the app already uses via `journalDate$`; exposing the whole set lets
  // callers (e.g. the notes tree) group journals without a per-doc subscription.
  allJournalDocIds$ = LiveData.computed(get => {
    return new Set(this.journalDocEntries(get).map(([docId]) => docId));
  });

  watchDocJournalDate(docId: string): Observable<string | undefined> {
    return LiveData.computed(get => {
      const doc = get(this.docsService.list.doc$(docId));
      if (!doc) {
        // if doc not exists
        return undefined;
      }
      const journal = get(doc.properties$.selector(p => p.journal));
      if (journal && !isJournalString(journal)) {
        return undefined;
      }
      return journal ?? undefined;
    });
  }

  setDocJournalDate(docId: string, date: string) {
    const doc = this.docsService.list.doc$(docId).value;
    if (!doc) {
      // doc not exists, do nothing
      return;
    }
    doc.setProperty('journal', date);
  }

  removeDocJournalDate(docId: string) {
    this.setDocJournalDate(docId, '');
  }

  getDocsByJournalDate(date: string) {
    return this.docsByJournalDate$(date).value;
  }
  docsByJournalDate$(date: string) {
    return LiveData.computed(get => {
      const docsMap = get(this.docsService.list.docsMap$);
      const journals = get(this.journalByDocId$);
      const docs = [];
      for (const [docId, journal] of journals) {
        const doc = journal === date ? docsMap.get(docId) : undefined;
        if (doc) docs.push(doc);
      }
      return docs;
    });
  }
}
