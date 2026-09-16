import { addProjectTaskListBlock } from '@blocksuite/notesgraph/blocks/database';
import { replaceIdMiddleware } from '@blocksuite/notesgraph/shared/adapters';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph/shared/types';
import type { DeltaInsert } from '@blocksuite/notesgraph/store';
import { Slice, Text, Transformer } from '@blocksuite/notesgraph/store';
import { DebugLogger } from '@notesgraph/debug';
import { Unreachable } from '@notesgraph/env/constant';
import { ObjectPool, Service } from '@notesgraph/infra';
import { combineLatest, map } from 'rxjs';

import { initDocFromProps } from '../../../blocksuite/initialization';
import { getNotesGraphWorkspaceSchema } from '../../workspace/global-schema';
import type { Doc } from '../entities/doc';
import { DocRecordList } from '../entities/record-list';
import { DocCreated, DocInitialized } from '../events';
import type { DocCreateMiddleware } from '../providers/doc-create-middleware';
import { DocScope } from '../scopes/doc';
import type { DocPropertiesStore } from '../stores/doc-properties';
import type { DocsStore } from '../stores/docs';
import type { DocCreateOptions } from '../types';
import { DocService } from './doc';
import { getDuplicatedDocTitle } from './duplicate-title';

const logger = new DebugLogger('DocsService');

export class DocsService extends Service {
  list = this.framework.createEntity(DocRecordList);

  pool = new ObjectPool<string, Doc>({
    onDelete(obj) {
      obj.scope.dispose();
    },
  });

  /**
   * Get all property values of a property, used for search
   *
   * Results may include docs in trash or deleted docs
   * Legacy property data such as old `journal` will not be included in the values
   */
  propertyValues$(propertyKey: string) {
    return combineLatest([
      this.store.watchDocIds(),
      this.docPropertiesStore.watchPropertyAllValues(propertyKey),
    ]).pipe(
      map(([docIds, propertyValues]) => {
        const result = new Map<string, string | undefined>();
        for (const docId of docIds) {
          result.set(docId, propertyValues.get(docId));
        }
        return result;
      })
    );
  }

  /**
   * used for search
   */
  allDocsCreatedDate$() {
    return this.store.watchAllDocCreateDate();
  }

  /**
   * used for search
   */
  allDocsUpdatedDate$() {
    return this.store.watchAllDocUpdatedDate();
  }

  allDocsTagIds$() {
    return this.store.watchAllDocTagIds();
  }

  allDocIds$() {
    return this.store.watchDocIds();
  }

  allNonTrashDocIds$() {
    return this.store.watchNonTrashDocIds();
  }

  allTrashDocIds$() {
    return this.store.watchTrashDocIds();
  }

  allDocTitle$() {
    return this.store.watchAllDocTitle();
  }

  constructor(
    private readonly store: DocsStore,
    private readonly docPropertiesStore: DocPropertiesStore,
    private readonly docCreateMiddlewares: DocCreateMiddleware[]
  ) {
    super();
  }

  loaded(docId: string) {
    const exists = this.pool.get(docId);
    if (exists) {
      return { doc: exists.obj, release: exists.release };
    }
    return null;
  }

  open(docId: string) {
    const docRecord = this.list.doc$(docId).value;
    if (!docRecord) {
      throw new Error('Doc record not found');
    }
    const blockSuiteDoc = this.store.getBlockSuiteDoc(docId);
    if (!blockSuiteDoc) {
      throw new Error('Doc not found');
    }

    const exists = this.pool.get(docId);
    if (exists) {
      return { doc: exists.obj, release: exists.release };
    }

    const docScope = this.framework.createScope(DocScope, {
      docId,
      blockSuiteDoc,
      record: docRecord,
    });

    try {
      blockSuiteDoc.load();
    } catch (e) {
      logger.error('Failed to load doc', {
        docId,
        error: e,
      });
    }

    const doc = docScope.get(DocService).doc;

    doc.scope.emitEvent(DocInitialized, doc);

    const { obj, release } = this.pool.put(docId, doc);

    return { doc: obj, release };
  }

  createDoc(options: DocCreateOptions = {}) {
    for (const middleware of this.docCreateMiddlewares) {
      options = middleware.beforeCreate
        ? middleware.beforeCreate(options)
        : options;
    }
    const id = this.store.createDoc(options.id);
    const docStore = this.store.getBlockSuiteDoc(id);
    if (!docStore) {
      throw new Error('Failed to create doc');
    }
    if (options.skipInit !== true) {
      initDocFromProps(docStore, options.docProps, options);
    }
    const docRecord = this.list.doc$(id).value;
    if (!docRecord) {
      throw new Unreachable();
    }
    if (options.primaryMode) {
      docRecord.setPrimaryMode(options.primaryMode);
    }
    if (options.isTemplate) {
      docRecord.setProperty('isTemplate', true);
    }
    for (const middleware of this.docCreateMiddlewares) {
      middleware.afterCreate?.(docRecord, options);
    }
    docRecord.setCreatedAt(Date.now());
    docRecord.setUpdatedAt(Date.now());
    this.eventBus.emit(DocCreated, {
      doc: docRecord,
      docCreateOptions: options,
    });
    return docRecord;
  }

  async addLinkedDoc(targetDocId: string, linkedDocId: string) {
    const { doc, release } = this.open(targetDocId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    await doc.waitForSyncReady();
    disposePriorityLoad();
    const text = new Text([
      {
        insert: ' ',
        attributes: {
          reference: {
            type: 'LinkedPage',
            pageId: linkedDocId,
          },
        },
      },
    ] as DeltaInsert<NotesGraphTextAttributes>[]);
    const [frame] = doc.blockSuiteDoc.getBlocksByFlavour('notesgraph:note');
    frame &&
      doc.blockSuiteDoc.addBlock(
        'notesgraph:paragraph' as never, // TODO(eyhn): fix type
        { text },
        frame.id
      );
    release();
  }

  /**
   * Create a note from content shared into the app via the OS share sheet
   * ("Share to NotesGraph"). A URL becomes a bookmark card; any other text
   * becomes a paragraph. `sharedTitle` (EXTRA_SUBJECT on Android — the
   * article title when sharing from Google Feed/Chrome, where EXTRA_TEXT is
   * only the URL) wins over the derived title. Returns the new doc id so the
   * caller can open it.
   */
  async createDocFromSharedText(
    rawText: string,
    sharedTitle?: string
  ): Promise<string> {
    const text = rawText.trim();
    const URL_RE = /https?:\/\/[^\s<>"']+/gi;

    // Split into segments: web links become bookmark cards, everything else
    // stays as paragraphs. Shares from browsers/apps are usually
    // "some text\nhttps://..." — the link is the payload, so card it.
    const segments: Array<{ type: 'text' | 'url'; value: string }> = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let last = 0;
      for (const match of trimmed.matchAll(URL_RE)) {
        const before = trimmed.slice(last, match.index).trim();
        if (before) segments.push({ type: 'text', value: before });
        segments.push({ type: 'url', value: match[0] });
        last = (match.index ?? 0) + match[0].length;
      }
      const rest = trimmed.slice(last).trim();
      if (rest) segments.push({ type: 'text', value: rest });
    }
    if (segments.length === 0) {
      segments.push({ type: 'text', value: text });
    }

    const firstText = segments.find(s => s.type === 'text')?.value;
    const firstUrl = segments.find(s => s.type === 'url')?.value;
    let title = (firstText ?? text).slice(0, 80) || 'Shared note';
    if (!firstText && firstUrl) {
      try {
        title = new URL(firstUrl).hostname || firstUrl;
      } catch {
        title = firstUrl;
      }
    }
    const explicitTitle = sharedTitle?.trim();
    if (explicitTitle) {
      title = explicitTitle.slice(0, 200);
    }

    const record = this.createDoc({ title });
    const { doc, release } = this.open(record.id);
    try {
      const disposePriorityLoad = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      disposePriorityLoad();
      const [note] = doc.blockSuiteDoc.getBlocksByFlavour('notesgraph:note');
      if (note) {
        for (const segment of segments) {
          if (segment.type === 'url') {
            doc.blockSuiteDoc.addBlock(
              'notesgraph:bookmark' as never, // TODO(eyhn): fix type
              { url: segment.value },
              note.id
            );
          } else {
            doc.blockSuiteDoc.addBlock(
              'notesgraph:paragraph' as never, // TODO(eyhn): fix type
              { text: new Text(segment.value) },
              note.id
            );
          }
        }
      }
    } finally {
      release();
    }
    return record.id;
  }

  /**
   * Scaffold a freshly-created journal day with one section per project: an
   * `H2` heading (the project name), that project's Task List (a query database
   * rendered as the list view, titled "todos:", scoped to that project's open
   * tasks), and an empty checklist item to jot a new task under. A final
   * "Inbox" section collects open tasks in docs that belong to no project, and
   * is added unconditionally — even when `sections` is empty (e.g. the
   * caller's project list hadn't loaded yet), the journal should still get a
   * Task List.
   */
  async addJournalProjectSections(
    docId: string,
    sections: { id: string; name: string }[]
  ) {
    const { doc, release } = this.open(docId);
    try {
      const disposePriorityLoad = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      disposePriorityLoad();
      const bsDoc = doc.blockSuiteDoc;
      const [note] = bsDoc.getBlocksByFlavour('notesgraph:note');
      if (!note) {
        return;
      }
      const addHeading = (text: string) =>
        bsDoc.addBlock(
          'notesgraph:paragraph' as never, // TODO(eyhn): fix type
          { type: 'h2', text: new Text(text) },
          note.id
        );
      /**
       * The empty checkbox goes *under* its heading, not beside it.
       *
       * This is what makes the section mean something. A project scope claims
       * tasks whose ancestor trail names it (see BlockTaskFilter.sectionName),
       * and the indexer builds that trail by walking parents — so a checkbox
       * that is a sibling of the "Ai" heading has an empty trail and belongs
       * to nothing, while a child of it belongs to Ai wherever it was written.
       * Scoping the journal by doc instead can't work: it has a section per
       * project, so it belongs to all of them and none.
       */
      const addEmptyChecklistItem = (parentId: string) =>
        bsDoc.addBlock(
          'notesgraph:list' as never, // TODO(eyhn): fix type
          { type: 'todo', text: new Text('') },
          parentId
        );

      for (const section of sections) {
        const headingId = addHeading(section.name);
        addProjectTaskListBlock(bsDoc, note.id, {
          projectId: section.id,
          name: 'todos:',
        });
        addEmptyChecklistItem(headingId);
      }

      // Everything not owned by a project. Nested for the same reason, so the
      // Inbox board can tell "written under Inbox" from "written under a
      // project" in the same journal.
      const inboxHeadingId = addHeading('Inbox');
      addProjectTaskListBlock(bsDoc, note.id, {
        noProject: true,
        name: 'todos:',
      });
      addEmptyChecklistItem(inboxHeadingId);
    } finally {
      release();
    }
  }

  /**
   * Create a "DoorDash Orders" doc from crawled orders (see the desktop
   * DoorDash crawler). Renders a heading + one bullet per order; kept
   * deliberately simple so it's robust — a richer sortable database is a
   * follow-up once the capture is validated against real data.
   */
  async createDoorDashOrdersDoc(
    orders: Array<{
      store?: string | number;
      date?: string | number;
      total?: string | number;
      itemCount?: string | number;
    }>
  ) {
    const record = this.createDoc({ title: 'DoorDash Orders' });
    const { doc, release } = this.open(record.id);
    try {
      const disposePriorityLoad = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      disposePriorityLoad();
      const bsDoc = doc.blockSuiteDoc;
      const [note] = bsDoc.getBlocksByFlavour('notesgraph:note');
      if (!note) {
        return record.id;
      }
      bsDoc.addBlock(
        'notesgraph:paragraph' as never, // TODO(eyhn): fix type
        {
          type: 'h2',
          text: new Text(`DoorDash orders (${orders.length})`),
        },
        note.id
      );
      for (const order of orders) {
        const parts = [
          order.store,
          order.date,
          order.total,
          order.itemCount != null ? `${order.itemCount} items` : undefined,
        ].filter(v => v != null && v !== '');
        bsDoc.addBlock(
          'notesgraph:list' as never, // TODO(eyhn): fix type
          {
            type: 'bulleted',
            text: new Text(parts.join(' · ') || 'Order'),
          },
          note.id
        );
      }
      return record.id;
    } finally {
      release();
    }
  }

  /**
   * Undo an {@link addLinkedDoc}: remove the reference(s) linking `parentDocId`
   * to `linkedDocId`. Only blocks whose text is *solely* a reference to the
   * linked doc are deleted (the drag-created links), so prose that merely
   * mentions the doc is left untouched. Lets drag-to-reparent behave as a move
   * (cut) instead of a copy.
   *
   * Also removes any `embed-linked-doc`/`embed-synced-doc` blocks pointing at
   * `linkedDocId` — those blocks *are* the reference (no surrounding prose to
   * preserve), so they're always safe to delete outright.
   */
  async removeLinkedDoc(parentDocId: string, linkedDocId: string) {
    const { doc, release } = this.open(parentDocId);
    try {
      const disposePriorityLoad = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      disposePriorityLoad();
      const bsDoc = doc.blockSuiteDoc;
      for (const flavour of [
        'notesgraph:paragraph',
        'notesgraph:list',
      ] as const) {
        for (const block of bsDoc.getBlocksByFlavour(flavour)) {
          const yText = (block.model.props as { text?: Text }).text?.yText;
          if (!yText) {
            continue;
          }
          const deltas =
            yText.toDelta() as DeltaInsert<NotesGraphTextAttributes>[];
          const referencesChild = deltas.some(
            delta => delta.attributes?.reference?.pageId === linkedDocId
          );
          const isOnlyReference = deltas.every(
            delta =>
              delta.attributes?.reference?.pageId === linkedDocId ||
              (typeof delta.insert === 'string' && delta.insert.trim() === '')
          );
          if (referencesChild && isOnlyReference) {
            bsDoc.deleteBlock(block.model);
          }
        }
      }
      for (const flavour of [
        'notesgraph:embed-linked-doc',
        'notesgraph:embed-synced-doc',
      ] as const) {
        for (const block of bsDoc.getBlocksByFlavour(flavour)) {
          if ((block.model.props as { pageId?: string }).pageId === linkedDocId) {
            bsDoc.deleteBlock(block.model);
          }
        }
      }
    } finally {
      release();
    }
  }

  async changeDocTitle(docId: string, newTitle: string) {
    const { doc, release } = this.open(docId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    await doc.waitForSyncReady();
    disposePriorityLoad();
    doc.changeDocTitle(newTitle);
    release();
  }

  /**
   * Merge `sourceDocId` into `targetDocId`: append the source's note blocks
   * to the end of the target doc, union the tags, then move the source to
   * trash (recoverable). Used by the mobile "combine with duplicate" action.
   */
  async mergeDocInto(sourceDocId: string, targetDocId: string) {
    if (sourceDocId === targetDocId) {
      return;
    }
    const { release: sourceRelease, doc: sourceDoc } = this.open(sourceDocId);
    const { release: targetRelease, doc: targetDoc } = this.open(targetDocId);
    try {
      await sourceDoc.waitForSyncReady();
      await targetDoc.waitForSyncReady();

      const sourceBsDoc = this.store.getBlockSuiteDoc(sourceDocId);
      const targetBsDoc = this.store.getBlockSuiteDoc(targetDocId);
      if (!sourceBsDoc) throw new Error('Source doc not found');
      if (!targetBsDoc) throw new Error('Target doc not found');

      // only note blocks: appending a second surface block would corrupt
      // the target's edgeless canvas
      const noteBlocks = (sourceBsDoc.root?.children ?? []).filter(
        child => child.flavour === 'notesgraph:note'
      );
      if (noteBlocks.length > 0) {
        const collection = this.store.getBlocksuiteCollection();
        const transformer = new Transformer({
          schema: getNotesGraphWorkspaceSchema(),
          blobCRUD: collection.blobSync,
          docCRUD: {
            create: (id: string) => {
              this.createDoc({ id });
              const store = collection.getDoc(id)?.getStore({ id });
              if (!store) {
                throw new Error('Failed to create doc');
              }
              return store;
            },
            get: (id: string) =>
              collection.getDoc(id)?.getStore({ id }) ?? null,
            delete: (id: string) => collection.removeDoc(id),
          },
          middlewares: [replaceIdMiddleware(collection.idGenerator)],
        });
        const slice = Slice.fromModels(sourceBsDoc, noteBlocks);
        const snapshot = transformer.sliceToSnapshot(slice);
        if (!snapshot) {
          throw new Error('Failed to create snapshot');
        }
        await transformer.snapshotToSlice(
          snapshot,
          targetBsDoc,
          targetBsDoc.root?.id
        );
      }

      // union tags so nothing is lost by the merge
      const mergedTags = Array.from(
        new Set([
          ...(targetDoc.meta$.value.tags ?? []),
          ...(sourceDoc.meta$.value.tags ?? []),
        ])
      );
      targetDoc.record.setMeta({ tags: mergedTags });

      this.list.doc$(sourceDocId).value?.moveToTrash();
    } finally {
      sourceRelease();
      targetRelease();
    }
  }

  async duplicate(sourceDocId: string, _targetDocId?: string) {
    const targetDocId = _targetDocId ?? this.createDoc().id;

    // check if source doc is removed
    if (this.list.doc$(sourceDocId).value?.trash$.value) {
      console.warn(
        `Template doc(id: ${sourceDocId}) is removed, skip duplicate`
      );
      return targetDocId;
    }

    const { release: sourceRelease, doc: sourceDoc } = this.open(sourceDocId);
    const { release: targetRelease, doc: targetDoc } = this.open(targetDocId);
    await sourceDoc.waitForSyncReady();

    // duplicate doc content
    try {
      const sourceBsDoc = this.store.getBlockSuiteDoc(sourceDocId);
      const targetBsDoc = this.store.getBlockSuiteDoc(targetDocId);
      if (!sourceBsDoc) throw new Error('Source doc not found');
      if (!targetBsDoc) throw new Error('Target doc not found');

      // clear the target doc (both surface and note)
      targetBsDoc.root?.children.forEach(child =>
        targetBsDoc.deleteBlock(child)
      );

      const collection = this.store.getBlocksuiteCollection();
      const transformer = new Transformer({
        schema: getNotesGraphWorkspaceSchema(),
        blobCRUD: collection.blobSync,
        docCRUD: {
          create: (id: string) => {
            this.createDoc({ id });
            const store = collection.getDoc(id)?.getStore({ id });
            if (!store) {
              throw new Error('Failed to create doc');
            }
            return store;
          },
          get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
          delete: (id: string) => collection.removeDoc(id),
        },
        middlewares: [replaceIdMiddleware(collection.idGenerator)],
      });
      const slice = Slice.fromModels(sourceBsDoc, [
        ...(sourceBsDoc.root?.children ?? []),
      ]);
      const snapshot = transformer.sliceToSnapshot(slice);
      if (!snapshot) {
        throw new Error('Failed to create snapshot');
      }
      await transformer.snapshotToSlice(
        snapshot,
        targetBsDoc,
        targetBsDoc.root?.id
      );
    } catch (e) {
      logger.error('Failed to duplicate doc', {
        sourceDocId,
        targetDocId,
        originalTargetDocId: _targetDocId,
        error: e,
      });
    } finally {
      sourceRelease();
      targetRelease();
    }

    // duplicate doc meta
    targetDoc.record.setMeta({
      tags: sourceDoc.meta$.value.tags,
    });

    // duplicate doc title
    targetDoc.changeDocTitle(getDuplicatedDocTitle(sourceDoc.title$.value));

    // duplicate doc properties
    const properties = sourceDoc.getProperties();
    const removedProperties = ['id', 'isTemplate', 'journal'];
    removedProperties.forEach(key => {
      delete properties[key];
    });
    targetDoc.updateProperties(properties);

    return targetDocId;
  }

  /**
   * Duplicate a doc from template
   * @param sourceDocId - the id of the source doc to be duplicated
   * @param _targetDocId - the id of the target doc to be duplicated, if not provided, a new doc will be created
   * @returns the id of the new doc
   */
  async duplicateFromTemplate(sourceDocId: string, _targetDocId?: string) {
    const targetDocId = _targetDocId ?? this.createDoc().id;

    // check if source doc is removed
    if (this.list.doc$(sourceDocId).value?.trash$.value) {
      console.warn(
        `Template doc(id: ${sourceDocId}) is removed, skip duplicate`
      );
      return targetDocId;
    }

    const { release: sourceRelease, doc: sourceDoc } = this.open(sourceDocId);
    const { release: targetRelease, doc: targetDoc } = this.open(targetDocId);
    await sourceDoc.waitForSyncReady();

    // duplicate doc content
    try {
      const sourceBsDoc = this.store.getBlockSuiteDoc(sourceDocId);
      const targetBsDoc = this.store.getBlockSuiteDoc(targetDocId);
      if (!sourceBsDoc) throw new Error('Source doc not found');
      if (!targetBsDoc) throw new Error('Target doc not found');

      // clear the target doc (both surface and note)
      targetBsDoc.root?.children.forEach(child =>
        targetBsDoc.deleteBlock(child)
      );

      const collection = this.store.getBlocksuiteCollection();
      const transformer = new Transformer({
        schema: getNotesGraphWorkspaceSchema(),
        blobCRUD: collection.blobSync,
        docCRUD: {
          create: (id: string) => {
            this.createDoc({ id });
            const store = collection.getDoc(id)?.getStore({ id });
            if (!store) {
              throw new Error('Failed to create doc');
            }
            return store;
          },
          get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
          delete: (id: string) => collection.removeDoc(id),
        },
        middlewares: [replaceIdMiddleware(collection.idGenerator)],
      });
      const slice = Slice.fromModels(sourceBsDoc, [
        ...(sourceBsDoc.root?.children ?? []),
      ]);
      const snapshot = transformer.sliceToSnapshot(slice);
      if (!snapshot) {
        throw new Error('Failed to create snapshot');
      }
      await transformer.snapshotToSlice(
        snapshot,
        targetBsDoc,
        targetBsDoc.root?.id
      );
    } catch (e) {
      logger.error('Failed to duplicate doc', {
        sourceDocId,
        targetDocId,
        originalTargetDocId: _targetDocId,
        error: e,
      });
    } finally {
      sourceRelease();
      targetRelease();
    }

    // duplicate doc properties
    const properties = sourceDoc.getProperties();
    const removedProperties = ['id', 'isTemplate', 'journal'];
    removedProperties.forEach(key => {
      delete properties[key];
    });
    targetDoc.updateProperties(properties);

    return targetDocId;
  }
}
