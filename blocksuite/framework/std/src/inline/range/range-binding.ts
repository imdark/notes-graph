import { IS_MOBILE } from '@blocksuite/global/env';
import type { BaseSelection, BlockModel } from '@blocksuite/store';
import throttle from 'lodash-es/throttle';

import { TextSelection } from '../../selection/index.js';
import { EditorHost } from '../../view/index.js';
import { INLINE_ROOT_ATTR } from '../consts.js';
import type { InlineRootElement } from '../inline-editor.js';
import { isActiveInEditor } from './active.js';
import { RANGE_SYNC_EXCLUDE_ATTR } from './consts.js';
import type { RangeManager } from './range-manager.js';

/**
 * A selection change this soon after a pointerdown is that tap's, not a
 * caret drag's. A tap's selectionchange lands within a frame or two.
 */
const TAP_WINDOW_MS = 500;

/**
 * Two-way binding between native range and text selection
 */
export class RangeBinding {
  private _compositionStartCallback:
    | ((event: CompositionEvent) => Promise<void>)
    | null = null;

  private readonly _computePath = (modelId: string) => {
    const block = this.host.std.store.getBlock(modelId)?.model;
    if (!block) return [];

    const path: string[] = [];
    let parent: BlockModel | null = block;
    while (parent) {
      path.unshift(parent.id);
      parent = this.host.store.getParent(parent);
    }

    return path;
  };

  private readonly _onBeforeInput = (event: InputEvent) => {
    const selection = this.selectionManager.find(TextSelection);
    if (!selection) return;

    if (event.isComposing) return;

    const { from, to } = selection;
    if (!to || from.blockId === to.blockId) return;

    const range = this.rangeManager?.value;
    if (!range) return;

    const blocks = this.rangeManager.getSelectedBlockComponentsByRange(range, {
      mode: 'flat',
    });

    const start = blocks.at(0);
    const end = blocks.at(-1);
    if (!start || !end) return;

    const startText = start.model.text;
    const endText = end.model.text;
    if (!startText || !endText) return;

    event.preventDefault();

    this.host.store.transact(() => {
      startText.delete(from.index, from.length);
      startText.insert(event.data ?? '', from.index);
      endText.delete(0, to.length);
      startText.join(endText);

      blocks
        .slice(1)
        // delete from lowest to highest
        .reverse()
        .forEach(block => {
          const parent = this.host.store.getParent(block.model);
          if (!parent) return;
          this.host.store.deleteBlock(block.model, {
            bringChildrenTo: parent,
          });
        });
    });

    const newSelection = this.selectionManager.create(TextSelection, {
      from: {
        blockId: from.blockId,
        index: from.index + (event.data?.length ?? 0),
        length: 0,
      },
      to: null,
    });
    this.selectionManager.setGroup('note', [newSelection]);
  };

  private readonly _onCompositionEnd = (event: CompositionEvent) => {
    if (this._compositionStartCallback) {
      event.preventDefault();
      event.stopPropagation();
      this._compositionStartCallback(event).catch(console.error);
      this._compositionStartCallback = null;
    }
  };

  private readonly _onCompositionStart = () => {
    const selection = this.selectionManager.find(TextSelection);
    if (!selection) return;

    const { from, to } = selection;
    if (!to) return;

    this.isComposing = true;

    const range = this.rangeManager?.value;
    if (!range) return;

    const blocks = this.rangeManager.getSelectedBlockComponentsByRange(range, {
      mode: 'flat',
    });

    const start = blocks.at(0);
    const end = blocks.at(-1);
    if (!start || !end) return;

    const startText = start.model.text;
    const endText = end.model.text;
    if (!startText || !endText) return;

    this._compositionStartCallback = async event => {
      this.isComposing = false;

      this.host.renderRoot.replaceChildren();
      // Because we bypassed Lit and disrupted the DOM structure, this will cause an inconsistency in the original state of `ChildPart`.
      // Therefore, we need to remove the original `ChildPart`.
      // https://github.com/lit/lit/blob/a2cd76cfdea4ed717362bb1db32710d70550469d/packages/lit-html/src/lit-html.ts#L2248

      delete (this.host.renderRoot as any)['_$litPart$'];
      this.host.requestUpdate();
      await this.host.updateComplete;

      this.host.store.captureSync();

      this.host.store.transact(() => {
        endText.delete(0, to.length);
        startText.delete(from.index, from.length);
        startText.insert(event.data, from.index);
        startText.join(endText);

        blocks
          .slice(1)
          // delete from lowest to highest
          .reverse()
          .forEach(block => {
            const parent = this.host.store.getParent(block.model);
            if (!parent) return;
            this.host.store.deleteBlock(block.model, {
              bringChildrenTo: parent,
            });
          });
      });

      await this.host.updateComplete;

      const selection = this.selectionManager.create(TextSelection, {
        from: {
          blockId: from.blockId,
          index: from.index + (event.data?.length ?? 0),
          length: 0,
        },
        to: null,
      });
      this.host.selection.setGroup('note', [selection]);
      this.rangeManager?.syncTextSelectionToRange(selection);
    };
  };

  private readonly _onNativeSelectionChanged = async () => {
    if (this.isComposing) return;
    if (!this.host) return; // Unstable when switching views, card <-> embed
    if (!isActiveInEditor(this.host)) {
      this._prevTextSelection = null;
      return;
    }

    await this.host.updateComplete;

    const selection = document.getSelection();
    if (!selection) {
      this.selectionManager.clear(['text']);
      return;
    }
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    if (!range) {
      if (this._keepDraggedCaret()) return;
      this._prevTextSelection = null;
      this.selectionManager.clear(['text']);
      return;
    }

    if (!this.host.contains(range.commonAncestorContainer)) {
      return;
    }

    // From legacy render lit portal
    if (range.commonAncestorContainer instanceof EditorHost) {
      return;
    }

    // range is in a non-editable element
    // ex. placeholder
    const isRangeOutNotEditable =
      range.startContainer instanceof HTMLElement &&
      range.startContainer.contentEditable === 'false' &&
      range.endContainer instanceof HTMLElement &&
      range.endContainer.contentEditable === 'false';
    if (isRangeOutNotEditable) {
      if (this._snapCaretIntoBlockText(range)) return;

      this._prevTextSelection = null;
      this.selectionManager.clear(['text']);

      // force clear native selection to break inline editor input
      selection.removeRange(range);
      return;
    }

    const startElement = getElement(range.startContainer);
    const endElement = getElement(range.endContainer);
    const hasInlineEndpoint =
      !!startElement?.closest('v-text') || !!endElement?.closest('v-text');

    const el = getElement(range.commonAncestorContainer);
    if (!el) return;

    const closestExclude = el.closest(`[${RANGE_SYNC_EXCLUDE_ATTR}="true"]`);
    if (closestExclude && !hasInlineEndpoint) return;

    const closestEditable = el.closest('[contenteditable]');
    if (!closestEditable && !hasInlineEndpoint) return;

    // if neither start nor end is in a v-text, the range is invalid
    if (!hasInlineEndpoint) {
      // Dragging the caret to a line start can land it on the inline root
      // itself; removing the range there blurs the editor and closes the
      // mobile keyboard, so keep it and wait for the next selection change.
      if (range.collapsed && el.closest(`[${INLINE_ROOT_ATTR}]`)) return;
      if (this._snapCaretIntoBlockText(range)) return;

      this._prevTextSelection = null;
      this.selectionManager.clear(['text']);

      selection.removeRange(range);
      return;
    }

    const inlineEditor = this.rangeManager?.getClosestInlineEditor(
      range.commonAncestorContainer
    );
    if (inlineEditor?.isComposing) return;

    const isRangeReversed =
      !!selection.anchorNode &&
      !!selection.focusNode &&
      (selection.anchorNode === selection.focusNode
        ? selection.anchorOffset > selection.focusOffset
        : selection.anchorNode.compareDocumentPosition(selection.focusNode) ===
          Node.DOCUMENT_POSITION_PRECEDING);
    const textSelection = this.rangeManager?.rangeToTextSelection(
      range,
      isRangeReversed
    );
    if (!textSelection) {
      this._prevTextSelection = null;
      this.selectionManager.clear(['text']);
      return;
    }

    const model = this.host.store.getModelById(textSelection.blockId);
    // If the model is not found, the selection maybe in another editor
    if (!model) return;

    this._prevTextSelection = {
      selection: textSelection,
      path: this._computePath(model.id),
    };
    this.rangeManager?.syncRangeToTextSelection(range, isRangeReversed);
  };

  private readonly _onStdSelectionChanged = (selections: BaseSelection[]) => {
    // TODO(@mirone): this is a trade-off, we need to use separate awareness store for every store to make sure the selection is isolated.
    const closestHost = document.activeElement?.closest('editor-host');
    if (closestHost && closestHost !== this.host) return;
    const active = this.host.event.active;
    if (!active) return;

    const text =
      selections.find((selection): selection is TextSelection =>
        selection.is(TextSelection)
      ) ?? null;

    if (!text && selections.length > 0) {
      const hasRecoverable = selections.find(selection => {
        const selectionConstructor =
          selection.constructor as typeof BaseSelection;
        return selectionConstructor.recoverable;
      });
      if (!hasRecoverable) {
        // prevent focus to top-level content-editable element
        // if the browser focus to the top-level content-editable element,
        // when switching between tabs,
        // the browser will focus to the top-level content-editable element
        this.host.focus({ preventScroll: true });
      }
    }

    if (text === this._prevTextSelection) {
      return;
    }
    // wait for lit updated
    this.host.updateComplete
      .then(() => {
        // A newer selection (e.g. a click) may have landed while waiting;
        // applying the captured one would move the caret back to it.
        const latest = this.selectionManager.find(TextSelection) ?? null;
        if (latest !== text) return;

        const id = text?.blockId;
        const path = id && this._computePath(id);

        if (active) {
          const eq =
            text && this._prevTextSelection && path
              ? text.equals(this._prevTextSelection.selection) &&
                path.join('') === this._prevTextSelection.path.join('')
              : false;

          if (eq) return;
        }

        this._prevTextSelection =
          text && path
            ? {
                selection: text,
                path,
              }
            : null;
        if (text) {
          this.rangeManager?.syncTextSelectionToRange(text);
        } else {
          this.rangeManager?.clear();
        }
      })
      .catch(console.error);
  };

  /**
   * Dragging the caret to a line start on mobile can drop it beside the
   * block's text: on a list item's checkbox or bullet (contenteditable=false)
   * or in the wrapper around them. Removing that range blurs the editor and
   * closes the keyboard, so move the caret to the nearest end of the block's
   * own text instead. Returns false when there is no such text to move to.
   *
   * Only for a caret moved by dragging, which on a phone is the system's
   * selection handle and sends no pointer events. A tap on a prefix (tick a
   * checkbox, fold a toggle, select by its bullet) comes with a pointerdown,
   * and is left to the prefix's own click handler as before. Desktop keeps
   * its behaviour: there a caret on a prefix is a click on it.
   */
  private _snapCaretIntoBlockText(range: Range) {
    if (!IS_MOBILE || !range.collapsed) return false;
    if (performance.now() - this._lastPointerDown < TAP_WINDOW_MS) return false;

    const block = this.rangeManager?.getClosestBlock(range.startContainer);
    if (!block) return false;
    const inlineRoot = block.querySelector<InlineRootElement>(
      `[${INLINE_ROOT_ATTR}]`
    );
    // Only the block's own text, and only from the row it sits in
    // (prefix, rich-text, placeholder), never from its children.
    if (!inlineRoot || this.rangeManager.getClosestBlock(inlineRoot) !== block)
      return false;
    const row = inlineRoot.closest('rich-text')?.parentElement;
    const startElement = getElement(range.startContainer);
    if (!row || !startElement || !row.contains(startElement)) return false;
    // Inside the text itself is an inline embed (a mention, a date, LaTeX):
    // its place in the line isn't either end, so leave it as it was.
    if (inlineRoot.contains(startElement)) return false;

    const inlineEditor = inlineRoot.inlineEditor;
    if (!inlineEditor) return false;
    const rootRange = document.createRange();
    rootRange.selectNodeContents(inlineRoot);
    const index =
      range.compareBoundaryPoints(Range.START_TO_START, rootRange) <= 0
        ? 0
        : inlineEditor.yTextLength;

    const textSelection = this.selectionManager.create(TextSelection, {
      from: { blockId: block.blockId, index, length: 0 },
      to: null,
    });
    this.selectionManager.setGroup('note', [textSelection]);
    this.rangeManager.syncTextSelectionToRange(textSelection);
    return true;
  }

  /**
   * Android's WebView drops the selection altogether when its caret handle
   * is dragged past the start of a line onto the list prefix: the range
   * goes from offset 0 to none, with no script involved. Clearing the text
   * selection then blurs the editor and closes the keyboard. On mobile,
   * with no tap behind it, put the caret back where the editor last had it
   * (the line start the drag reached) instead.
   *
   * Code that means to drop the caret clears the editor's text selection
   * first, so there is nothing to put back and this stays out of its way.
   */
  private _keepDraggedCaret() {
    if (!IS_MOBILE) return false;
    if (performance.now() - this._lastPointerDown < TAP_WINDOW_MS) return false;
    const text = this.selectionManager.find(TextSelection);
    if (!text || text.to || text.from.length !== 0) return false;
    this.rangeManager?.syncTextSelectionToRange(text);
    return true;
  }

  /** When a pointer last went down, to tell a tap from a handle drag. */
  private _lastPointerDown = -Infinity;

  private _prevTextSelection: {
    selection: TextSelection;
    path: string[];
  } | null = null;

  isComposing = false;

  get host() {
    return this.manager.std.host;
  }

  get rangeManager() {
    return this.host.range;
  }

  get selectionManager() {
    return this.host.selection;
  }

  constructor(public manager: RangeManager) {
    this.host.disposables.add(
      this.selectionManager.slots.changed.subscribe(this._onStdSelectionChanged)
    );

    this.host.disposables.addFromEvent(
      document,
      'selectionchange',
      throttle(() => {
        this._onNativeSelectionChanged().catch(console.error);
      }, 10)
    );

    this.host.disposables.addFromEvent(
      document,
      'pointerdown',
      () => {
        this._lastPointerDown = performance.now();
      },
      { capture: true, passive: true }
    );

    this.host.disposables.add(
      this.host.event.add('beforeInput', ctx => {
        const event = ctx.get('defaultState').event as InputEvent;
        this._onBeforeInput(event);
      })
    );

    this.host.disposables.addFromEvent(
      this.host,
      'compositionstart',
      this._onCompositionStart
    );
    this.host.disposables.addFromEvent(
      this.host,
      'compositionend',
      this._onCompositionEnd,
      {
        capture: true,
      }
    );
  }
}

function getElement(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  return node.parentElement;
}
