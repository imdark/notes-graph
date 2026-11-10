import { LiveData, Service } from '@notesgraph/infra';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  type Observable,
  of,
  switchMap,
} from 'rxjs';

import type { DocsService } from '../../doc';
import type { DocsSearchService } from '../../docs-search';
import type { FeatureFlagService } from '../../feature-flag';
import type { JournalService } from '../../journal';
import type { OrganizeService } from '../../organize';
import type { TagService } from '../../tag';
import {
  CONVERSATIONS_HUB_TITLE,
  SPECIAL_KINDS,
  SPECIAL_TAGS,
  type SpecialKind,
} from '../constants';

type KindDocIds = Record<SpecialKind, string[]>;

const sameIds = (a: string[], b: string[]) => a.join() === b.join();

/**
 * Special tags: an ordinary workspace tag per kind of note the app makes
 * (journal pages, agent conversations, calendar event notes, captured ideas).
 *
 * The app recognises each kind the way it always has (the `journal`
 * property, the `calendarEvent` property, the `ai / conversations` folder or
 * a link under a "conversations" note, the `capturedAt` property capture mode
 * sets) and puts the kind's tag on the note
 * once, remembering that in the note's `specialTagged` property. From then on
 * the tag is what counts: remove it and the note is an ordinary note, and it
 * is not put back.
 */
export class SpecialTagsService extends Service {
  constructor(
    private readonly featureFlags: FeatureFlagService,
    private readonly tags: TagService,
    private readonly docs: DocsService,
    private readonly docsSearch: DocsSearchService,
    private readonly journal: JournalService,
    private readonly organize: OrganizeService
  ) {
    super();
  }

  get enabled$() {
    return this.featureFlags.flags.enable_special_tags.$;
  }

  /** The docs carrying each special tag. */
  readonly docIdsByKind$ = LiveData.from(
    combineLatest(
      SPECIAL_KINDS.map(kind =>
        this.tags.tagList.watchTagPageIds(SPECIAL_TAGS[kind].id)
      )
    ).pipe(
      map(
        lists =>
          new Map(SPECIAL_KINDS.map((kind, i) => [kind, new Set(lists[i])]))
      )
    ),
    new Map<SpecialKind, Set<string>>()
  );

  /**
   * Docs carrying the tag of a record kind (journal, conversation, calendar
   * event): the ones parent suggestions, the Inbox and Duplicates leave out.
   */
  readonly recordDocIds$ = this.docIdsByKind$.map(
    byKind =>
      new Set(
        [...byKind.entries()]
          .filter(([kind]) => SPECIAL_TAGS[kind].isRecord)
          .flatMap(([, ids]) => [...ids])
      )
  );

  /** Notes titled "conversations" that `wf` links each conversation under. */
  private readonly conversationHubIds$: Observable<string[]> =
    this.docs.list.docs$.pipe(
      map(records =>
        records
          .filter(
            r =>
              !r.trash$.value &&
              (r.title$.value ?? '').trim().toLowerCase() ===
                CONVERSATIONS_HUB_TITLE
          )
          .map(r => r.id)
      ),
      distinctUntilChanged(sameIds)
    );

  /**
   * Agent conversation transcripts: docs in the `ai / conversations` folder,
   * plus every doc linked under a "conversations" note (the folder alone
   * misses transcripts that were linked but never filed).
   */
  private readonly detectedConversationIds$: Observable<string[]> =
    combineLatest([
      this.organize.conversationDocIds$,
      this.conversationHubIds$.pipe(
        switchMap(hubIds =>
          hubIds.length === 0
            ? of([] as string[])
            : this.docsSearch.watchRefsFrom(hubIds).pipe(
                map(refs => refs.map(r => r.docId)),
                catchError(() => of([] as string[]))
              )
        )
      ),
    ]).pipe(map(([filed, linked]) => [...new Set([...filed, ...linked])]));

  /** Docs the app recognises as each kind, tagged or not. */
  private readonly detected$: Observable<KindDocIds> = combineLatest([
    this.journal.allJournalDocIds$,
    this.docs.schemaPropertyValues$('calendarEvent'),
    this.detectedConversationIds$,
    this.docs.schemaPropertyValues$('capturedAt'),
  ]).pipe(
    map(([journalIds, calendarValues, conversationIds, capturedValues]) => ({
      journal: [...journalIds],
      'calendar-event': [...calendarValues]
        .filter(([, value]) => !!value?.externalEventId)
        .map(([id]) => id),
      'ai-conversation': conversationIds,
      'captured-idea': [...capturedValues]
        .filter(([, value]) => !!value)
        .map(([id]) => id),
    }))
  );

  /**
   * Notes never to suggest as a parent. With special tags on, any note
   * carrying one; otherwise journal pages and conversations as detected.
   * The "conversations" hub notes are left out either way.
   */
  readonly notParentIds$: Observable<Set<string>> = this.enabled$.pipe(
    switchMap(enabled =>
      combineLatest([
        enabled
          ? this.recordDocIds$.map(ids => [...ids])
          : this.detected$.pipe(
              map(d => [...d.journal, ...d['ai-conversation']])
            ),
        this.conversationHubIds$,
      ])
    ),
    map(([ids, hubIds]) => new Set([...ids, ...hubIds]))
  );

  /**
   * Tag newly recognised notes while special tags are on. Returns a stop
   * function; mount once per workspace.
   */
  start() {
    const subscription = this.enabled$
      .pipe(
        distinctUntilChanged(),
        switchMap(enabled =>
          enabled
            ? // docs$ re-runs it once records load, so a doc detected before
              // its record existed is not skipped for good.
              combineLatest([this.detected$, this.docs.list.docs$]).pipe(
                debounceTime(2000)
              )
            : EMPTY
        )
      )
      .subscribe(([detected]) => {
        try {
          this.apply(detected);
        } catch (err) {
          console.error('[special-tags] tagging failed:', err);
        }
      });
    return () => subscription.unsubscribe();
  }

  private apply(detected: KindDocIds) {
    for (const kind of SPECIAL_KINDS) {
      const def = SPECIAL_TAGS[kind];
      for (const docId of detected[kind]) {
        const record = this.docs.list.doc$(docId).value;
        if (!record || record.trash$.value) continue;
        const applied = record.getProperties().specialTagged ?? [];
        if (applied.includes(kind)) continue;
        this.tags.tagList.ensureTag(def);
        const tags = record.meta$.value.tags ?? [];
        if (!tags.includes(def.id)) {
          record.setMeta({ tags: [...tags, def.id] });
        }
        record.setProperty('specialTagged', [...applied, kind]);
      }
    }
  }
}
