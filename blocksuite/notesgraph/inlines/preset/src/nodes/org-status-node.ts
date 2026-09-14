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

const CHIP_COLORS: Record<string, { color: string; background: string }> = {
  Todo: { color: 'var(--affine-text-secondary-color, #8e8d91)', background: 'var(--affine-hover-color, rgba(0,0,0,.04))' },
  'In Progress': { color: 'var(--affine-processing-color, #1e96eb)', background: 'rgba(30,150,235,.12)' },
  Done: { color: 'var(--affine-success-color, #10cb86)', background: 'rgba(16,203,134,.12)' },
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
    notesgraph-org-status .org-status-chevron {
      font-size: 0.8em;
      opacity: 0.6;
    }
  `;

  get statusText() {
    return this.delta.attributes?.orgStatus ?? this.delta.insert;
  }

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
    // the caret. It sits outside the contenteditable="false" chip so the
    // cursor can anchor to it.
    return html`<span
        class="org-status-chip"
        style="color: ${palette.color}; background: ${palette.background};"
        contenteditable="false"
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
