import { IS_MOBILE } from '@blocksuite/global/env';
import type {
  DatabaseBlockModel,
  ListBlockModel,
} from '@blocksuite/notesgraph-model';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph-shared/commands';
import { FeatureFlagService } from '@blocksuite/notesgraph-shared/services';
import {
  insertPositionToIndex,
  type InsertToPosition,
} from '@blocksuite/notesgraph-shared/utils';
import { type EditorHost, TextSelection } from '@blocksuite/std';
import type { BlockModel, Store } from '@blocksuite/store';
import { computed, type ReadonlySignal } from '@preact/signals-core';

import {
  MIRROR_ROW_FLAVOUR,
  OrgTaskRowsDataSource,
} from './org-task-rows-data-source.js';
import { focusCreatedBlock } from './utils/focus-block.js';

export { MIRROR_ROW_FLAVOUR };

/**
 * A database whose rows are a live view of a bullet list living somewhere
 * else — possibly in another doc — instead of the database block's own
 * children. The source list is identified by an anchor list block
 * (`mirrorDocId`/`mirrorBlockId` props); the row set is the contiguous run
 * of list blocks around that anchor, so items added to or removed from the
 * list show up in the table immediately, and vice versa.
 *
 * The org-mode status/timestamp machinery lives in the shared
 * {@link OrgTaskRowsDataSource} base.
 */
export class MirrorListDataSource extends OrgTaskRowsDataSource {
  private readonly sourceStore$: ReadonlySignal<Store | null> = computed(
    () => {
      const docId = this._model.props.mirrorDocId$.value;
      if (!docId || docId === this._model.store.id) {
        return this._model.store;
      }
      const doc = this._model.store.workspace.getDoc(docId);
      if (!doc) return null;
      if (!doc.loaded) {
        try {
          doc.load();
        } catch (e) {
          console.error(e);
          return null;
        }
      }
      // Stable id — bare getStore() would mint a fresh empty Store per call.
      return doc.getStore({ id: docId });
    }
  );

  protected override watchedStores$: ReadonlySignal<Store[]> = computed(() => {
    const store = this.sourceStore$.value;
    return store ? [store] : [];
  });

  private readonly anchorModel$: ReadonlySignal<BlockModel | null> = computed(
    () => {
      const store = this.sourceStore$.value;
      const anchorId = this._model.props.mirrorBlockId$.value;
      if (!store || !anchorId) return null;
      return store.getBlock$(anchorId)?.model ?? null;
    }
  );

  /**
   * The contiguous run of list blocks around the anchor, in source order.
   * Reads `parent.children` (a computed signal), so it recomputes whenever
   * items are inserted, removed or reordered in the source list.
   */
  protected override sourceRowModels$: ReadonlySignal<BlockModel[]> = computed(
    () => {
      const anchor = this.anchorModel$.value;
      const parent = anchor?.parent;
      if (!anchor || !parent) return [];
      const siblings = parent.children;
      const index = siblings.findIndex(v => v.id === anchor.id);
      if (index < 0) return [];
      let start = index;
      while (
        start > 0 &&
        siblings[start - 1]?.flavour === MIRROR_ROW_FLAVOUR
      ) {
        start--;
      }
      let end = index;
      while (
        end + 1 < siblings.length &&
        siblings[end + 1]?.flavour === MIRROR_ROW_FLAVOUR
      ) {
        end++;
      }
      return siblings.slice(start, end + 1);
    }
  );

  override readonly$: ReadonlySignal<boolean> = computed(() => {
    return (
      this._model.store.readonly ||
      (this.sourceStore$.value?.readonly ?? true) ||
      (IS_MOBILE &&
        !this._model.store.provider
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing'))
    );
  });

  override rowAdd(insertPosition: InsertToPosition | number): string {
    const anchor = this.anchorModel$.value;
    const store = this.sourceStore$.value;
    const parent = anchor?.parent;
    if (!anchor || !store || !parent) return '';

    const rows = this.sourceRowModels$.value;
    const index =
      typeof insertPosition === 'number'
        ? insertPosition
        : insertPositionToIndex(insertPosition, rows);
    const first = rows[0];
    const runStart = first
      ? parent.children.findIndex(v => v.id === first.id)
      : 0;

    store.captureSync();
    return store.addBlock(
      MIRROR_ROW_FLAVOUR,
      { type: (anchor as ListBlockModel).props.type ?? 'bulleted' },
      parent,
      runStart + Math.min(index, rows.length)
    );
  }

  override rowDelete(ids: string[]): void {
    // The anchor identifies the source list; if it's among the deleted rows,
    // re-anchor to a surviving row first so the mirror keeps tracking the
    // rest of the list.
    const anchorId = this._model.props.mirrorBlockId;
    if (anchorId && ids.includes(anchorId)) {
      const survivor = this.sourceRowModels$.value.find(
        v => !ids.includes(v.id)
      );
      this._model.store.captureSync();
      this._model.props.mirrorBlockId = survivor?.id;
    }
    super.rowDelete(ids);
  }

  override rowMove(rowId: string, position: InsertToPosition): void {
    const store = this.sourceStore$.value;
    const rows = this.sourceRowModels$.value;
    const model = rows.find(v => v.id === rowId);
    const parent = model?.parent;
    if (!store || !model || !parent) return;

    const index = insertPositionToIndex(position, rows);
    const target = rows[index];
    if (target?.id === rowId) return;

    store.captureSync();
    if (target) {
      store.moveBlocks([model], parent, target, true);
    } else {
      // Past the end of the run: place after the current last row rather
      // than at the end of the parent, which could jump past non-list
      // blocks that follow the list.
      const last = rows[rows.length - 1];
      if (!last || last.id === rowId) return;
      store.moveBlocks([model], parent, last, false);
    }
  }
}

/**
 * Creates a database block that mirrors the selected bullet list, placed
 * right after the end of the list's contiguous run so the run stays intact.
 * Unlike `convertToDatabase`, the source blocks are not moved — the new
 * database's rows are a live two-way view of the list.
 */
export const mirrorListToDatabase = (host: EditorHost, viewType: string) => {
  const [_, ctx] = host.std.command.exec(getSelectedModelsCommand, {
    types: ['block', 'text'],
  });
  const { selectedModels } = ctx;
  if (!selectedModels?.length) return;

  // Anchor on the block where the text selection starts when possible —
  // getSelectedModels promotes fully-covered children to their parent,
  // which would anchor a nested-list selection one level too high.
  const textSelection = host.std.selection.find(TextSelection);
  let anchor = textSelection
    ? host.store.getBlock(textSelection.from.blockId)?.model
    : undefined;
  if (anchor?.flavour !== MIRROR_ROW_FLAVOUR) {
    anchor = selectedModels.find(v => v.flavour === MIRROR_ROW_FLAVOUR);
  }
  if (!anchor) return;

  // A database block can only live under a note. If the anchor is a
  // nested list item, its run still mirrors fine (rows follow the anchor's
  // siblings), but the database block itself must be placed at note level
  // — after the whole top-level list containing the anchor.
  let insertParent = host.store.getParent(anchor);
  let topAncestor: BlockModel = anchor;
  while (insertParent && insertParent.flavour !== 'notesgraph:note') {
    topAncestor = insertParent;
    insertParent = host.store.getParent(insertParent);
  }
  if (!insertParent) return;

  const siblings = insertParent.children;
  let end = siblings.findIndex(v => v.id === topAncestor.id);
  if (end < 0) return;
  while (
    end + 1 < siblings.length &&
    siblings[end + 1]?.flavour === MIRROR_ROW_FLAVOUR
  ) {
    end++;
  }

  host.store.captureSync();
  const id = host.store.addBlock(
    'notesgraph:database',
    {
      mirrorDocId: host.store.id,
      mirrorBlockId: anchor.id,
    },
    insertParent,
    end + 1
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    return;
  }
  const datasource = new MirrorListDataSource(databaseModel);
  // No template rows — the rows are the source list itself.
  datasource.viewManager.viewAdd(viewType);

  host.selection.clear();
  focusCreatedBlock(host, id);
};
