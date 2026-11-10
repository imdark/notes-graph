/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { BehaviorSubject, firstValueFrom, map, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DocsService } from '../../doc';
import { DocsSearchService } from '../../docs-search';
import { FeatureFlagService } from '../../feature-flag';
import { JournalService } from '../../journal';
import { OrganizeService } from '../../organize';
import { TagService } from '../../tag';
import { SPECIAL_TAGS } from '../constants';
import { SpecialTagsService } from '../services/special-tags';

interface FakeDoc {
  id: string;
  title: string;
  tags: string[];
  props: { specialTagged?: string[] };
}

/** A workspace of docs, with just the parts the service reads and writes. */
function setup(docs: FakeDoc[], opts: { enabled?: boolean } = {}) {
  const docs$ = new BehaviorSubject(docs);
  const enabled$ = new BehaviorSubject(opts.enabled ?? true);
  const ensureTag = vi.fn();

  const record = (doc: FakeDoc) => ({
    id: doc.id,
    title$: { value: doc.title },
    trash$: { value: false },
    meta$: { value: { tags: doc.tags } },
    getProperties: () => doc.props,
    setMeta: (meta: { tags: string[] }) => {
      doc.tags = meta.tags;
      docs$.next([...docs$.value]);
    },
    setProperty: (key: 'specialTagged', value: string[]) => {
      doc.props[key] = value;
    },
  });

  const framework = new Framework();
  framework
    .service(FeatureFlagService, {
      flags: { enable_special_tags: { $: enabled$ } },
    } as any)
    .service(TagService, {
      tagList: {
        ensureTag,
        watchTagPageIds: (tagId: string) =>
          docs$.pipe(
            map(list => list.filter(d => d.tags.includes(tagId)).map(d => d.id))
          ),
      },
    } as any)
    .service(DocsService, {
      list: {
        docs$: docs$.pipe(map(list => list.map(record))),
        doc$: (id: string) => {
          const doc = docs$.value.find(d => d.id === id);
          return { value: doc ? record(doc) : undefined };
        },
      },
      schemaPropertyValues$: () =>
        of(new Map([['cal1', { externalEventId: 'e1', date: '2026-11-09' }]])),
    } as any)
    // the "conversations" hub links conv2
    .service(DocsSearchService, {
      watchRefsFrom: () => of([{ docId: 'conv2' }]),
    } as any)
    .service(JournalService, { allJournalDocIds$: of(new Set(['j1'])) } as any)
    // conv1 is filed in the ai / conversations folder
    .service(OrganizeService, { conversationDocIds$: of(['conv1']) } as any)
    .service(SpecialTagsService, [
      FeatureFlagService,
      TagService,
      DocsService,
      DocsSearchService,
      JournalService,
      OrganizeService,
    ]);
  const service = framework.provider().get(SpecialTagsService);
  return { service, docs, docs$, enabled$, ensureTag };
}

const workspace = (): FakeDoc[] => [
  { id: 'j1', title: '2026-11-09', tags: [], props: {} },
  { id: 'cal1', title: 'Standup', tags: [], props: {} },
  { id: 'conv1', title: '2026-10-21 TASK-13 · 430b6a77', tags: [], props: {} },
  { id: 'conv2', title: '2026-10-21 TASK-10 · b711e374', tags: [], props: {} },
  { id: 'hub', title: 'conversations', tags: [], props: {} },
  { id: 'plain', title: 'trip to canada', tags: ['mine'], props: {} },
];

const tagsOf = (docs: FakeDoc[]) =>
  Object.fromEntries(docs.map(d => [d.id, d.tags]));

describe('SpecialTagsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('tags each recognised note with its kind, once', async () => {
    const { service, docs, ensureTag } = setup(workspace());
    const stop = service.start();
    await vi.advanceTimersByTimeAsync(2500);
    stop();

    expect(tagsOf(docs)).toEqual({
      j1: [SPECIAL_TAGS.journal.id],
      cal1: [SPECIAL_TAGS['calendar-event'].id],
      conv1: [SPECIAL_TAGS['ai-conversation'].id],
      conv2: [SPECIAL_TAGS['ai-conversation'].id],
      hub: [],
      plain: ['mine'],
    });
    expect(docs.find(d => d.id === 'conv2')?.props.specialTagged).toEqual([
      'ai-conversation',
    ]);
    expect(ensureTag).toHaveBeenCalledWith(SPECIAL_TAGS.journal);
  });

  test('a tag the user removed is not put back', async () => {
    const docs = workspace();
    const conv1 = docs.find(d => d.id === 'conv1')!;
    conv1.props.specialTagged = ['ai-conversation'];
    const { service } = setup(docs);
    const stop = service.start();
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(conv1.tags).toEqual([]);
  });

  test('does nothing while the flag is off', async () => {
    const { service, docs } = setup(workspace(), { enabled: false });
    const stop = service.start();
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(docs.every(d => d.id === 'plain' || d.tags.length === 0)).toBe(true);
  });

  test('flag on: tagged notes and the hub are never parents', async () => {
    const docs = workspace();
    docs.find(d => d.id === 'cal1')!.tags = [SPECIAL_TAGS['calendar-event'].id];
    const { service } = setup(docs);
    const ids = await firstValueFrom(service.notParentIds$);
    // only what carries a tag (none of the others are tagged yet), plus the hub
    expect([...ids].sort()).toEqual(['cal1', 'hub']);
  });

  test('flag off: journal pages, conversations and the hub', async () => {
    const { service } = setup(workspace(), { enabled: false });
    const ids = await firstValueFrom(service.notParentIds$);
    expect([...ids].sort()).toEqual(['conv1', 'conv2', 'hub', 'j1']);
  });
});
