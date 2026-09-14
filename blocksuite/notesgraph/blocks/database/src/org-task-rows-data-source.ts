import { IS_MOBILE } from '@blocksuite/global/env';
import { FeatureFlagService } from '@blocksuite/notesgraph-shared/services';
import {
  applyOrgStatusTimestamps,
  findOrgTimestampIn,
  formatLaneDeclaration,
  inferLaneRole,
  type InsertToPosition,
  LANE_DECLARATION_PREFIX,
  type LaneRole,
  orgKeywordForDateColumn,
  type OrgPlanningKeyword,
  orgStatusLabel,
  orgStatusMatches,
  orgStatusText,
  parseOrgStatusPrefix,
  parseTaskType,
  setOrgTimestampIn,
  TASK_TYPES,
  taskTypeInfo,
} from '@blocksuite/notesgraph-shared/utils';
import { type BlockModel, type Store, Text } from '@blocksuite/store';
import {
  computed,
  effect,
  type ReadonlySignal,
  signal,
} from '@preact/signals-core';

import { DatabaseBlockDataSource } from './data-source.js';
import { deleteRows } from './utils/block-utils.js';

export const MIRROR_ROW_FLAVOUR = 'notesgraph:list';

/**
 * Base for database data sources whose rows are list blocks living
 * elsewhere — in one list (mirror) or scattered across the workspace
 * (query). Rows are real block models; the title column binds their text
 * directly, and the org-mode task machinery lives here:
 *
 * - a select column named "Status" reads/writes the org annotation in the
 *   item's own text (`[ ]`, `[-]`, `[X]`, keywords), with native checkbox
 *   state as fallback, stamping STARTED/CLOSED planning timestamps;
 * - date columns named Scheduled/Deadline/Started/Closed/Created map to
 *   org planning annotations at the end of the item's text.
 *
 * Columns, cells (keyed by source block id) and views still live on the
 * database block itself. Subclasses define where rows come from
 * (`sourceRowModels$`) and which stores to watch for text edits
 * (`watchedStores$`) — Y.Text content isn't a signal, so text-derived
 * reads depend on a version counter bumped on store updates.
 */
export abstract class OrgTaskRowsDataSource extends DatabaseBlockDataSource {
  protected abstract sourceRowModels$: ReadonlySignal<BlockModel[]>;
  protected abstract watchedStores$: ReadonlySignal<Store[]>;

  protected readonly sourceTextVersion$ = signal(0);

  /** Coalescing window for source-text change notifications, ms. */
  private static readonly TEXT_VERSION_WINDOW_MS = 250;
  private textVersionBumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Note that watched source text changed, at most once per window. Callers
   * can fire this per Y.Doc update across hundreds of docs; recomputing rows
   * that often is what made a freshly loaded board janky.
   */
  private bumpSourceTextVersion(): void {
    if (this.textVersionBumpTimer !== null) return;
    this.textVersionBumpTimer = setTimeout(() => {
      this.textVersionBumpTimer = null;
      this.sourceTextVersion$.value++;
    }, OrgTaskRowsDataSource.TEXT_VERSION_WINDOW_MS);
  }

  constructor(
    model: ConstructorParameters<typeof DatabaseBlockDataSource>[0],
    init?: ConstructorParameters<typeof DatabaseBlockDataSource>[1]
  ) {
    super(model, init);
    // Deferred: subclass field initializers (sourceRowModels$/watchedStores$)
    // run only after this base constructor returns, and effect() evaluates
    // its callback immediately.
    queueMicrotask(() => {
      effect(() => {
        const stores = this.watchedStores$.value;
        // Y.Doc-level updates cover text typing too — blockUpdated doesn't
        // fire for Y.Text edits since blocks are only shallowly observed.
        //
        // Coalesced: a query board watches EVERY hit's store, which for a
        // workspace-wide task query is hundreds of docs. While those stream
        // in from sync each one fires updates, and bumping the signal per
        // update re-ran the row computation (and re-rendered every board)
        // once per update — a storm of full recomputes right after load.
        // One recompute per window is enough to stay live.
        const handler = () => {
          this.bumpSourceTextVersion();
        };
        for (const store of stores) {
          store.spaceDoc.on('update', handler);
        }
        return () => {
          for (const store of stores) {
            store.spaceDoc.off('update', handler);
          }
        };
      });
    });
  }

  override rows$: ReadonlySignal<string[]> = computed(() => {
    const models = this.sourceRowModels$.value;
    // A task nested under another row renders INSIDE its parent's card
    // (epic -> child cards), not as its own top-level card.
    const ids = new Set(models.map(v => v.id));
    return models
      .filter(model => {
        const parent = model.store.getParent(model);
        return !(parent && ids.has(parent.id));
      })
      .map(v => v.id);
  });

  override readonly$: ReadonlySignal<boolean> = computed(() => {
    return (
      this._model.store.readonly ||
      (IS_MOBILE &&
        !this._model.store.provider
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing'))
    );
  });

  protected override getModelById(rowId: string): BlockModel | undefined {
    return this.sourceRowModels$.value.find(v => v.id === rowId);
  }

  /**
   * The select property a kanban groups by (named "Status") is backed by an
   * org-mode annotation in the source item's own text (`[ ]`, `[-]`, `[X]`,
   * or an uppercase keyword) instead of this block's cells, so the status
   * lives in the plain text representation of the list.
   */
  protected isOrgStatusProperty(propertyId: string): boolean {
    return (
      this.propertyTypeGet(propertyId) === 'select' &&
      this.propertyNameGet(propertyId).trim().toLowerCase() === 'status'
    );
  }

  protected statusOptions(
    propertyId: string
  ): { id: string; value: string }[] {
    const options = this.propertyDataGet(propertyId).options;
    return Array.isArray(options) ? options : [];
  }

  /**
   * Mirrors the board's visible lane set into the doc as a plain-text
   * org-style declaration (`#+SEQ_TODO: [ ] [-] BLOCKED(b) | [X]`) so the
   * workflow itself is readable/editable as text. Called (duck-typed) by
   * the lane-management panel after any lane change; updates the existing
   * declaration paragraph or inserts one right above this database block.
   */
  writeLaneDeclaration(lanes: { value: string; role: LaneRole }[]): void {
    const store = this._model.store;
    if (store.readonly) return;
    const line = formatLaneDeclaration(lanes);
    const existing = store
      .getBlocksByFlavour('notesgraph:paragraph')
      .map(b => b.model)
      .find(m =>
        (m.text?.toString() ?? '').trimStart().startsWith(
          LANE_DECLARATION_PREFIX
        )
      );
    if (existing?.text) {
      if (existing.text.toString() !== line) {
        existing.text.replace(0, existing.text.length, line);
      }
      return;
    }
    const parent = store.getParent(this._model);
    if (!parent) return;
    const index = parent.children.findIndex(c => c.id === this._model.id);
    store.addBlock(
      'notesgraph:paragraph',
      { text: new Text(line) },
      parent,
      Math.max(index, 0)
    );
  }

  /**
   * Task-type badge for a card, parsed from the inline `#type:<x>` token in
   * the row's own text. Duck-typed contract consumed by the generic kanban
   * card/menu (see data-view kanban card.ts / menu.ts) — the data-view
   * package stays org-agnostic.
   */
  cardBadge(rowId: string): { label: string; color: string } | null {
    // depend on the text version so badges re-render on typing
    void this.sourceTextVersion$.value;
    const text = this.getModelById(rowId)?.text?.toString();
    if (!text) return null;
    const parsed = parseTaskType(text);
    if (!parsed) return null;
    const info = taskTypeInfo(parsed.type);
    return { label: info.label, color: info.color };
  }

  /** The type choices offered by the card menu's "Set type" submenu. */
  cardTypeOptions(): { type: string; label: string; color: string }[] {
    return TASK_TYPES;
  }

  /** The row's current type token value (`bug`), or null. */
  cardTypeOf(rowId: string): string | null {
    void this.sourceTextVersion$.value;
    const text = this.getModelById(rowId)?.text?.toString();
    return text ? (parseTaskType(text)?.type ?? null) : null;
  }

  /**
   * Sets, replaces or (with null) removes the row's `#type:<x>` token,
   * editing the task line's own text so the type stays plain-text truth.
   */
  setCardType(rowId: string, type: string | null): void {
    const text = this.getModelById(rowId)?.text;
    if (!text) return;
    const plain = text.toString();
    const existing = parseTaskType(plain);
    if (existing) {
      if (type) {
        text.replace(existing.index, existing.length, `#type:${type}`);
      } else {
        // also swallow one preceding space
        const from =
          existing.index > 0 && plain[existing.index - 1] === ' '
            ? existing.index - 1
            : existing.index;
        text.delete(from, existing.index + existing.length - from);
      }
    } else if (type) {
      text.insert(` #type:${type}`, text.length);
    }
    this.sourceTextVersion$.value++;
  }

  /** Org status text of an arbitrary task model (chip, raw, or checkbox). */
  private modelOrgStatusText(model: BlockModel): string | null {
    const text = model.text;
    if (text) {
      const first = text.toDelta()[0] as
        | { insert?: string; attributes?: { orgStatus?: string } }
        | undefined;
      if (typeof first?.attributes?.orgStatus === 'string') {
        return first.attributes.orgStatus;
      }
      const prefix = parseOrgStatusPrefix(text.toString());
      if (prefix) return prefix.statusText;
    }
    if (model.flavour === MIRROR_ROW_FLAVOUR) {
      const props = model.props as { type?: string; checked?: boolean };
      if (props.type === 'todo') return props.checked ? '[X]' : '[ ]';
    }
    return null;
  }

  /** A task line's display text: raw annotations and stamps stripped. */
  private taskDisplayText(model: BlockModel): string {
    let text = model.text?.toString() ?? '';
    const prefix = parseOrgStatusPrefix(text);
    if (prefix) text = text.slice(prefix.length);
    text = text.replace(
      /(SCHEDULED|DEADLINE|CLOSED|STARTED|CREATED):\s*[[<][^\]>]*[\]>]/g,
      ''
    );
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Child tasks nested under a row — rendered INSIDE the parent's card as
   * mini-cards (epic -> stories). Duck-typed contract for the kanban card.
   */
  cardChildren(
    rowId: string
  ): { id: string; text: string; done: boolean }[] {
    void this.sourceTextVersion$.value;
    const model = this.getModelById(rowId);
    if (!model) return [];
    return model.children
      .filter(child => child.flavour === MIRROR_ROW_FLAVOUR)
      .map(child => ({ child, status: this.modelOrgStatusText(child) }))
      .filter(({ status }) => status != null)
      .map(({ child, status }) => ({
        id: child.id,
        text: this.taskDisplayText(child),
        done: orgStatusLabel(status ?? '[ ]') === 'Done',
      }));
  }

  /** Toggles a child task between done and todo from the parent's card. */
  toggleChildDone(rowId: string, childId: string): void {
    const model = this.getModelById(rowId);
    const child = model?.children.find(c => c.id === childId);
    const text = child?.text;
    if (!child || !text) return;
    const store = child.store;
    store.captureSync();
    const wasDone =
      orgStatusLabel(this.modelOrgStatusText(child) ?? '[ ]') === 'Done';
    const statusText = wasDone ? '[ ]' : '[X]';
    const first = text.toDelta()[0] as
      | { insert?: string; attributes?: { orgStatus?: string } }
      | undefined;
    if (typeof first?.attributes?.orgStatus === 'string' && first.insert) {
      text.format(0, first.insert.length, { orgStatus: statusText });
    } else {
      const prefix = parseOrgStatusPrefix(text.toString());
      if (prefix) {
        let length = prefix.length;
        if (text.toString()[length] === ' ') length++;
        text.replace(0, length, ' ', { orgStatus: statusText });
      } else {
        text.insert(' ', 0);
        text.insert(' ', 0, { orgStatus: statusText });
      }
    }
    const props = child.props as { type?: string; checked?: boolean };
    if (props.type === 'todo' && 'checked' in child.props) {
      store.updateBlock(child, { checked: !wasDone });
    }
    applyOrgStatusTimestamps(
      text.yText,
      orgStatusLabel(statusText),
      Date.now(),
      wasDone ? 'start' : 'done'
    );
    this.sourceTextVersion$.value++;
  }

  /**
   * The current org status of a row: either an embedded chip (a single
   * attributed character at the start, whose `orgStatus` attribute holds
   * the org text) or a raw typed annotation like `[-] ` / `DONE `.
   */
  protected rowOrgStatus(
    rowId: string
  ): { statusText: string; length: number; embedded: boolean } | null {
    const text = this.getModelById(rowId)?.text;
    if (!text) return null;
    const first = text.toDelta()[0] as
      | { insert?: string; attributes?: { orgStatus?: string } }
      | undefined;
    const embedStatus = first?.attributes?.orgStatus;
    if (typeof embedStatus === 'string' && first?.insert) {
      return {
        statusText: embedStatus,
        length: first.insert.length,
        embedded: true,
      };
    }
    const prefix = parseOrgStatusPrefix(text.toString());
    if (!prefix) return null;
    return { ...prefix, embedded: false };
  }

  /**
   * Fallback for rows with no explicit org annotation: GFM task-list
   * syntax (`- [ ]` / `- [x]`) is *also* org-mode's own bracket syntax, and
   * blocksuite's markdown parser (used by MCP writes) and its live typing
   * input rule both claim it first — the brackets never reach the item's
   * actual text, ending up as the list item's native `type`/`checked`
   * fields instead. Read that native state as Todo/Done so those items
   * still group correctly; an explicit org annotation always wins.
   */
  protected nativeCheckboxOrgText(rowId: string): '[ ]' | '[X]' | null {
    const model = this.getModelById(rowId);
    if (model?.flavour !== MIRROR_ROW_FLAVOUR) return null;
    const props = model.props as { type?: string; checked?: boolean };
    if (props.type !== 'todo') return null;
    return props.checked ? '[X]' : '[ ]';
  }

  /**
   * A date column whose name maps to an org planning keyword (Scheduled /
   * Deadline / Started / Closed / Created) reads and writes an org
   * timestamp annotation at the end of the source item's text instead of
   * this block's cells.
   */
  protected orgDateKeyword(propertyId: string): OrgPlanningKeyword | null {
    if (this.propertyTypeGet(propertyId) !== 'date') return null;
    return orgKeywordForDateColumn(this.propertyNameGet(propertyId));
  }

  /** Finds a keyword's timestamp on a row — chip embed or raw typed text. */
  protected rowTimestamp(rowId: string, keyword: OrgPlanningKeyword) {
    const text = this.getModelById(rowId)?.text;
    return text ? findOrgTimestampIn(text.yText, keyword) : null;
  }

  protected setRowTimestamp(
    rowId: string,
    keyword: OrgPlanningKeyword,
    epochMs: number | null
  ): void {
    const text = this.getModelById(rowId)?.text;
    if (!text) return;
    setOrgTimestampIn(text.yText, keyword, epochMs);
  }

  override cellValueGet(rowId: string, propertyId: string): unknown {
    const dateKeyword = this.orgDateKeyword(propertyId);
    if (dateKeyword) {
      this.sourceTextVersion$.value;
      const stamp = this.rowTimestamp(rowId, dateKeyword);
      if (stamp) return stamp.epochMs;
      if (dateKeyword === 'CREATED') {
        const model = this.getModelById(rowId);
        const createdAt = (
          model?.props as { 'meta:createdAt'?: number } | undefined
        )?.['meta:createdAt'];
        return createdAt ?? null;
      }
      return null;
    }
    if (this.isOrgStatusProperty(propertyId)) {
      this.sourceTextVersion$.value;
      const statusText =
        this.rowOrgStatus(rowId)?.statusText ??
        this.nativeCheckboxOrgText(rowId);
      if (!statusText) return null;
      const option = this.statusOptions(propertyId).find(o =>
        orgStatusMatches(statusText, o.value)
      );
      return option?.id ?? null;
    }
    return super.cellValueGet(rowId, propertyId);
  }

  override cellValueChange(
    rowId: string,
    propertyId: string,
    value: unknown
  ): void {
    const dateKeyword = this.orgDateKeyword(propertyId);
    if (dateKeyword) {
      const store = this.getModelById(rowId)?.store;
      if (!store) return;
      store.captureSync();
      this.setRowTimestamp(
        rowId,
        dateKeyword,
        typeof value === 'number' ? value : null
      );
      return;
    }
    if (this.isOrgStatusProperty(propertyId)) {
      const model = this.getModelById(rowId);
      const text = model?.text;
      if (!model || !text) return;
      const store = model.store;

      const option = this.statusOptions(propertyId).find(o => o.id === value);
      const status = this.rowOrgStatus(rowId);
      store.captureSync();

      if (!option) {
        if (status) {
          let length = status.length;
          if (text.toString()[length] === ' ') length++;
          text.delete(0, length);
        }
        return;
      }

      const statusText = orgStatusText(option.value);
      if (status?.embedded) {
        text.format(0, status.length, { orgStatus: statusText });
      } else if (status) {
        // Replace a raw typed annotation with the single-character chip
        // embed; the whitespace after it is kept as the separator.
        text.replace(0, status.length, ' ', { orgStatus: statusText });
      } else {
        text.insert(' ', 0);
        text.insert(' ', 0, { orgStatus: statusText });
      }

      // Org-mode logging: entering a done-role lane stamps CLOSED,
      // reopening removes it; the first move into any non-start lane
      // stamps STARTED. Explicit lane roles win over label heuristics.
      const role =
        (option as { role?: LaneRole }).role ?? inferLaneRole(option.value);
      applyOrgStatusTimestamps(
        text.yText,
        orgStatusLabel(statusText),
        Date.now(),
        role
      );

      // Keep the native checkbox in sync with the lane's role.
      if (
        (model.props as { type?: string }).type === 'todo' &&
        'checked' in model.props
      ) {
        store.updateBlock(model, { checked: role === 'done' });
      }
      return;
    }
    super.cellValueChange(rowId, propertyId, value);
  }

  /** Row insertion is source-specific; disabled unless a subclass opts in. */
  override rowAdd(_insertPosition: InsertToPosition | number): string {
    return '';
  }

  override rowDelete(ids: string[]): void {
    for (const id of ids) {
      const model = this.getModelById(id);
      if (model) {
        model.store.captureSync();
        model.store.deleteBlock(model);
      }
    }
    deleteRows(this._model, ids);
  }

  /** Row ordering is source-specific; no-op unless a subclass opts in. */
  override rowMove(_rowId: string, _position: InsertToPosition): void {}
}
