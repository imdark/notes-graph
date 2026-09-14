import { DisposableGroup } from '@blocksuite/global/disposable';
import { deleteLineBlock } from '@blocksuite/notesgraph-block-note';
import { deleteTextCommand } from '@blocksuite/notesgraph-inline-preset';
import {
  ListBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/notesgraph-model';
import {
  pasteMiddleware,
  replaceIdMiddleware,
  surfaceRefToEmbed,
  uploadMiddleware,
} from '@blocksuite/notesgraph-shared/adapters';
import {
  clearAndSelectFirstModelCommand,
  deleteSelectedModelsCommand,
  getBlockIndexCommand,
  getBlockSelectionsCommand,
  getImageSelectionsCommand,
  getSelectedModelsCommand,
  getTextSelectionCommand,
  retainFirstModelCommand,
} from '@blocksuite/notesgraph-shared/commands';
import { EmbedOptionProvider } from '@blocksuite/notesgraph-shared/services';
import {
  isValidUrl,
  matchModels,
  parseSyncedBlockHtml,
  parseSyncedBlockPayload,
  SYNCED_BLOCK_CLIPBOARD_TYPE,
  SYNCED_BLOCK_FLAVOUR,
  type SyncedBlockClipboardPayload,
} from '@blocksuite/notesgraph-shared/utils';
import { TextSelection, type UIEventHandler } from '@blocksuite/std';
import type { BlockSnapshot, Store } from '@blocksuite/store';

import { ReadOnlyClipboard } from './readonly-clipboard';

/**
 * PageClipboard is a class that provides a clipboard for the page root block.
 * It is supported to copy and paste models in the page root block.
 */
export class PageClipboard extends ReadOnlyClipboard {
  static override key = 'notesgraph-page-clipboard';

  protected _init = () => {
    this._initAdapters();
    const paste = pasteMiddleware(this.std);
    // Use surfaceRefToEmbed middleware to convert surface-ref to embed-linked-doc
    // When pastina a surface-ref block to another doc
    const surfaceRefToEmbedMiddleware = surfaceRefToEmbed(this.std);
    const replaceId = replaceIdMiddleware(this.std.store.workspace.idGenerator);
    const upload = uploadMiddleware(this.std);
    this.std.clipboard.use(paste);
    this.std.clipboard.use(surfaceRefToEmbedMiddleware);
    this.std.clipboard.use(replaceId);
    this.std.clipboard.use(upload);
    this._disposables.add({
      dispose: () => {
        this.std.clipboard.unuse(paste);
        this.std.clipboard.unuse(surfaceRefToEmbedMiddleware);
        this.std.clipboard.unuse(replaceId);
        this.std.clipboard.unuse(upload);
      },
    });
  };

  onBlockSnapshotPaste = async (
    snapshot: BlockSnapshot,
    doc: Store,
    parent?: string,
    index?: number
  ) => {
    const block = await this.std.clipboard.pasteBlockSnapshot(
      snapshot,
      doc,
      parent,
      index
    );
    return block?.id ?? null;
  };

  onPageCut: UIEventHandler = ctx => {
    const e = ctx.get('clipboardState').raw;
    e.preventDefault();

    // Cut-line: the platform cut combo with a collapsed cursor cuts the
    // whole line — expand the selection to the full line so the copy
    // pipeline captures its text, then delete the block (the caret lands
    // on the neighboring line).
    const textSelection = this.std.selection.find(TextSelection);
    if (textSelection?.isCollapsed()) {
      const model = this.std.store.getBlock(textSelection.from.blockId)?.model;
      if (
        model &&
        matchModels(model, [ParagraphBlockModel, ListBlockModel])
      ) {
        this.std.selection.setGroup('note', [
          this.std.selection.create(TextSelection, {
            from: {
              blockId: model.id,
              index: 0,
              length: model.text?.length ?? 0,
            },
            to: null,
          }),
        ]);
        this._copySelectedInPage(() => {
          deleteLineBlock(this.std, model);
        }).run();
        return;
      }
    }

    this._copySelectedInPage(() => {
      this.std.command
        .chain()
        .try<{}>(cmd => [
          cmd.pipe(getTextSelectionCommand).pipe(deleteTextCommand),
          cmd.pipe(getSelectedModelsCommand).pipe(deleteSelectedModelsCommand),
        ])
        .run();
    }).run();
  };

  /**
   * "Copy as synced block" payloads become a live synced-block embed at the
   * cursor instead of a text paste — the Notion synced-block flow, step 2.
   * Returns true when handled.
   */
  private _pasteSyncedBlock(clipboardData: DataTransfer | null): boolean {
    if (!clipboardData) return false;
    // same-page custom MIME fast path, then the text/html data-attribute
    // carrier (survives the OS clipboard)
    const payload: SyncedBlockClipboardPayload | null =
      parseSyncedBlockPayload(
        clipboardData.getData(SYNCED_BLOCK_CLIPBOARD_TYPE)
      ) ?? parseSyncedBlockHtml(clipboardData.getData('text/html'));
    if (!payload) return false;

    const [, ctx] = this.std.command
      .chain()
      .pipe(getSelectedModelsCommand, { types: ['text', 'block'] })
      .run();
    const target = ctx.selectedModels?.at(-1);
    if (!target) return false;

    this.std.store.captureSync();
    this.std.store.addSiblingBlocks(
      target,
      [
        {
          flavour: SYNCED_BLOCK_FLAVOUR,
          pageId: payload.pageId,
          blockId: payload.blockId,
        },
      ],
      'after'
    );
    return true;
  }

  /**
   * Paste bare URLs on an empty paragraph as bookmark cards instead of inline
   * text. A single URL, or several lines where *every* line is a full-line URL,
   * each become their own card. Returns true when handled; anything else (plain
   * text, mixed lines, or a URL on a non-empty line) keeps the normal paste.
   */
  private _pasteUrlsAsBookmarks(clipboardData: DataTransfer | null): boolean {
    const text = clipboardData?.getData('text/plain');
    if (!text) {
      return false;
    }
    const urls = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    // Only when every pasted line is a bare, full-line http(s) URL. Any TLD,
    // query string, or fragment is fine here — this is an explicit paste, not
    // the conservative typing auto-link (which limits to common TLDs).
    if (
      urls.length === 0 ||
      !urls.every(url => /^https?:\/\/\S+$/i.test(url) && isValidUrl(url))
    ) {
      return false;
    }

    const textSelection = this.std.selection.find(TextSelection);
    if (!textSelection?.isCollapsed()) {
      return false;
    }
    const model = this.std.store.getBlock(textSelection.from.blockId)?.model;
    if (
      !model ||
      model.flavour !== 'notesgraph:paragraph' ||
      (model.text?.length ?? 0) > 0
    ) {
      return false;
    }
    const parent = this.std.store.getParent(model);
    if (!parent) {
      return false;
    }

    this.std.store.captureSync();
    const embedProvider = this.std.get(EmbedOptionProvider);
    const baseIndex = parent.children.indexOf(model);
    // Insert each card right after the empty paragraph, in order.
    urls.forEach((url, i) => {
      const flavour =
        embedProvider.getEmbedBlockOptions(url)?.flavour ??
        'notesgraph:bookmark';
      this.std.store.addBlock(
        flavour as never,
        { url },
        parent,
        baseIndex + 1 + i
      );
    });
    // Replace the empty line with the card(s).
    this.std.store.deleteBlock(model);
    return true;
  }

  onPagePaste: UIEventHandler = ctx => {
    const e = ctx.get('clipboardState').raw;
    e.preventDefault();

    if (this.std.store.readonly) return;

    if (this._pasteSyncedBlock(e.clipboardData)) {
      return;
    }

    if (this._pasteUrlsAsBookmarks(e.clipboardData)) {
      return;
    }

    this.std.store.captureSync();
    let hasPasteTarget = false;
    this.std.command
      .chain()
      .try<{}>(cmd => [
        cmd.pipe(getTextSelectionCommand).pipe((ctx, next) => {
          const { currentTextSelection } = ctx;
          if (!currentTextSelection) {
            return;
          }
          const { from, to } = currentTextSelection;
          if (to && from.blockId !== to.blockId) {
            this.std.command.exec(deleteTextCommand, {
              currentTextSelection,
            });
          }
          return next();
        }),
        cmd
          .pipe(getSelectedModelsCommand)
          .pipe(clearAndSelectFirstModelCommand)
          .pipe(retainFirstModelCommand)
          .pipe(deleteSelectedModelsCommand),
      ])
      .try<{ currentSelectionPath: string }>(cmd => [
        cmd.pipe(getTextSelectionCommand).pipe((ctx, next) => {
          const textSelection = ctx.currentTextSelection;
          if (!textSelection) {
            return;
          }
          next({ currentSelectionPath: textSelection.from.blockId });
        }),
        cmd.pipe(getBlockSelectionsCommand).pipe((ctx, next) => {
          const currentBlockSelections = ctx.currentBlockSelections;
          if (!currentBlockSelections) {
            return;
          }
          const blockSelection = currentBlockSelections.at(-1);
          if (!blockSelection) {
            return;
          }
          next({ currentSelectionPath: blockSelection.blockId });
        }),
        cmd.pipe(getImageSelectionsCommand).pipe((ctx, next) => {
          const currentImageSelections = ctx.currentImageSelections;
          if (!currentImageSelections) {
            return;
          }
          const imageSelection = currentImageSelections.at(-1);
          if (!imageSelection) {
            return;
          }
          next({ currentSelectionPath: imageSelection.blockId });
        }),
      ])
      .pipe(getBlockIndexCommand)
      .pipe((ctx, next) => {
        if (!ctx.parentBlock) {
          return;
        }
        hasPasteTarget = true;
        this.std.clipboard
          .paste(
            e,
            this.std.store,
            ctx.parentBlock.model.id,
            ctx.blockIndex !== undefined ? ctx.blockIndex + 1 : 1
          )
          .catch(console.error);

        return next();
      })
      .run();

    if (hasPasteTarget) return;

    // If no valid selection target exists (for example, stale block selection
    // right after cut), create/focus the default paragraph and paste after it.
    const firstParagraphId = document
      .querySelector('notesgraph-page-root')
      ?.focusFirstParagraph?.()?.id;
    const parentModel = firstParagraphId
      ? this.std.store.getParent(firstParagraphId)
      : null;
    const paragraphIndex =
      firstParagraphId && parentModel
        ? parentModel.children.findIndex(child => child.id === firstParagraphId)
        : -1;
    const insertIndex = paragraphIndex >= 0 ? paragraphIndex + 1 : undefined;

    this.std.clipboard
      .paste(e, this.std.store, parentModel?.id, insertIndex)
      .catch(console.error);
  };

  override mounted() {
    if (!navigator.clipboard) {
      console.error(
        'navigator.clipboard is not supported in current environment.'
      );
      return;
    }
    if (this._disposables.disposed) {
      this._disposables = new DisposableGroup();
    }
    this.std.event.add('copy', this.onPageCopy);
    this.std.event.add('paste', this.onPagePaste);
    this.std.event.add('cut', this.onPageCut);
    this._init();
  }
}
