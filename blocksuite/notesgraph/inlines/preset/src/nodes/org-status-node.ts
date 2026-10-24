import { IS_MOBILE } from '@blocksuite/global/env';
import { WithDisposable } from '@blocksuite/global/lit';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import type {
  NotesGraphInlineEditor,
  NotesGraphTextAttributes,
} from '@blocksuite/notesgraph-shared/types';
import {
  applyOrgStatusTimestamps,
  ORG_STATUS_CANONICAL,
  orgStatusLabel,
} from '@blocksuite/notesgraph-shared/utils';
import { ShadowlessElement } from '@blocksuite/std';
import {
  ZERO_WIDTH_FOR_EMBED_NODE,
  ZERO_WIDTH_FOR_EMPTY_LINE,
} from '@blocksuite/std/inline';
import type { DeltaInsert } from '@blocksuite/store';
import { css, html } from 'lit';
import { property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

/**
 * The chip is contenteditable=false on desktop. On a phone it is editable and
 * selectable, and a caret that lands inside it is moved straight out (see
 * `_moveCaretOutOfChip`).
 *
 * Android moves the caret under its drag handle by hit-testing that point.
 * A status opens its line, so a caret dragged to the start of the line lands
 * on the chip. A chip that is non-editable or unselectable (user-select: none)
 * gives no caret position there, so the WebView drops the selection and the
 * keyboard closes. Unlike the list prefix (get-list-icon.ts), the chip sits
 * inside the inline editor, so it needs a valid caret position of its own.
 */
const chipEditable = IS_MOBILE ? undefined : 'false';

const CHIP_COLORS: Record<string, { color: string; background: string }> = {
  Todo: {
    color: 'var(--affine-text-secondary-color, #8e8d91)',
    background: 'var(--affine-hover-color, rgba(0,0,0,.04))',
  },
  'In Progress': {
    color: 'var(--affine-processing-color, #1e96eb)',
    background: 'rgba(30,150,235,.12)',
  },
  Done: {
    color: 'var(--affine-success-color, #10cb86)',
    background: 'rgba(16,203,134,.12)',
  },
};

const FALLBACK_CHIP_COLOR = {
  color: 'var(--affine-brand-color, #1e96eb)',
  background: 'rgba(30,150,235,.12)',
};

/**
 * Renders an org-mode status annotation (`[ ]`, `[-]`, `[X]`, `WAITING`…)
 * as a status chip with a dropdown. The underlying document text keeps the
 * plain org annotation; picking a status from the dropdown rewrites it.
 */
export class OrgStatusNode extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    notesgraph-org-status {
      display: inline;
    }
    notesgraph-org-status .org-status-chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 6px;
      margin: 0 2px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
      line-height: 1.5;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      vertical-align: baseline;
    }
    notesgraph-org-status .org-status-chip.mobile {
      user-select: text;
      -webkit-user-select: text;
    }
    notesgraph-org-status .org-status-chevron {
      font-size: 0.8em;
      opacity: 0.6;
    }
  `;

  get statusText() {
    return this.delta.attributes?.orgStatus ?? this.delta.insert;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (IS_MOBILE) {
      this.disposables.addFromEvent(
        document,
        'selectionchange',
        this._moveCaretOutOfChip
      );
    }
  }

  /**
   * Moves a caret that landed inside the chip to the start of the text after
   * it. This must happen synchronously on the DOM selection: going through
   * the inline editor applies on the next frame, by which time a caret drag
   * has put the caret back inside the chip and the WebView has dropped it.
   */
  private readonly _moveCaretOutOfChip = () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const chip = this.querySelector('.org-status-chip');
    if (!chip?.contains(selection.focusNode)) return;

    const next = this.closest('v-element')?.nextElementSibling;
    const text = next
      ? document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (text) selection.collapse(text, 0);
  };

  private readonly onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.editor?.isReadonly) return;

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          ...ORG_STATUS_CANONICAL.map(status =>
            menu.action({
              name: status.label,
              isSelected:
                orgStatusLabel(this.statusText).toLowerCase() ===
                status.label.toLowerCase(),
              select: () => this.setStatus(status.text),
            })
          ),
          menu.group({
            items: [
              menu.action({
                name: 'Remove status',
                select: () => this.removeStatus(),
              }),
            ],
          }),
        ],
      },
    });
  };

  private setStatus(statusText: string) {
    const editor = this.editor;
    if (!editor) return;
    editor.formatText(
      { index: this.startOffset, length: this.endOffset - this.startOffset },
      { orgStatus: statusText }
    );
    // Same org logging a kanban status change performs: Done stamps
    // CLOSED, reopening removes it, first active status stamps STARTED.
    editor.transact(() => {
      applyOrgStatusTimestamps(
        editor.yText,
        orgStatusLabel(statusText),
        Date.now()
      );
    });
  }

  private removeStatus() {
    const editor = this.editor;
    if (!editor) return;
    let length = this.endOffset - this.startOffset;
    // Also swallow the whitespace that separated the annotation from the
    // item text, so removing a status doesn't leave a leading space.
    if (editor.yTextString[this.endOffset] === ' ') {
      length += 1;
    }
    editor.deleteText({ index: this.startOffset, length });
  }

  override render() {
    const label = orgStatusLabel(this.statusText);
    const palette = CHIP_COLORS[label] ?? FALLBACK_CHIP_COLOR;
    // The trailing `<v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}>` is required in
    // an embed node so the inline editor computes ranges correctly — without
    // it, typing in a block that has a status chip lands one character before
    // the caret. It sits outside the chip so the cursor can anchor to it.
    return html`<span
        class=${IS_MOBILE ? 'org-status-chip mobile' : 'org-status-chip'}
        style="color: ${palette.color}; background: ${palette.background};"
        contenteditable=${ifDefined(chipEditable)}
        @click=${this.onClick}
        >${label}<span class="org-status-chevron">▾</span></span
      ><v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}></v-text>`;
  }

  @property({ type: Object })
  accessor delta: DeltaInsert<NotesGraphTextAttributes> = {
    insert: ZERO_WIDTH_FOR_EMPTY_LINE,
  };

  @property({ attribute: false })
  accessor editor: NotesGraphInlineEditor | null = null;

  @property({ type: Number })
  accessor startOffset = 0;

  @property({ type: Number })
  accessor endOffset = 0;

  @property({ type: Boolean })
  accessor selected = false;
}
