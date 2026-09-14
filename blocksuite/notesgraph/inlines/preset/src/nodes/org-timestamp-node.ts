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
import { parseOrgTimestamp } from '@blocksuite/notesgraph-shared/utils';
import { ShadowlessElement } from '@blocksuite/std';
import { ZERO_WIDTH_FOR_EMPTY_LINE } from '@blocksuite/std/inline';
import type { DeltaInsert } from '@blocksuite/store';
import { css, html } from 'lit';
import { property } from 'lit/decorators.js';

const KEYWORD_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  DEADLINE: 'Deadline',
  CLOSED: 'Closed',
  STARTED: 'Started',
  CREATED: 'Created',
};

const KEYWORD_COLORS: Record<string, string> = {
  SCHEDULED: 'var(--affine-processing-color, #1e96eb)',
  DEADLINE: 'var(--affine-error-color, #eb4335)',
  CLOSED: 'var(--affine-success-color, #10cb86)',
  STARTED: 'var(--affine-brand-color, #1e96eb)',
  CREATED: 'var(--affine-text-secondary-color, #8e8d91)',
};

/**
 * Renders an org-mode planning/log timestamp (`SCHEDULED: <…>`,
 * `CLOSED: […]`…) as a small date badge. The document keeps the plain org
 * annotation in the attribute; the badge shows keyword + date and offers
 * removal via its menu.
 */
export class OrgTimestampNode extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    notesgraph-org-timestamp {
      display: inline;
    }
    notesgraph-org-timestamp .org-timestamp-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 0 5px;
      margin: 0 2px;
      border-radius: 4px;
      font-size: 0.78em;
      line-height: 1.6;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      vertical-align: baseline;
      background: var(--affine-hover-color, rgba(0, 0, 0, 0.04));
    }
    notesgraph-org-timestamp .org-timestamp-keyword {
      font-weight: 600;
    }
    notesgraph-org-timestamp .org-timestamp-date {
      color: var(--affine-text-secondary-color, #8e8d91);
    }
  `;

  get annotation() {
    return this.delta.attributes?.orgTimestamp ?? this.delta.insert;
  }

  private readonly onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.editor?.isReadonly) return;

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.action({
            name: 'Remove date',
            select: () => this.removeTimestamp(),
          }),
        ],
      },
    });
  };

  private removeTimestamp() {
    const editor = this.editor;
    if (!editor) return;
    let index = this.startOffset;
    let length = this.endOffset - this.startOffset;
    // Swallow the separating space before the badge (badges sit at the end
    // of the line after a space).
    if (index > 0 && editor.yTextString[index - 1] === ' ') {
      index -= 1;
      length += 1;
    } else if (editor.yTextString[this.endOffset] === ' ') {
      length += 1;
    }
    editor.deleteText({ index, length });
  }

  override render() {
    const parsed = parseOrgTimestamp(this.annotation);
    const keyword = parsed?.keyword ?? 'CREATED';
    const label = KEYWORD_LABELS[keyword] ?? keyword;
    const color = KEYWORD_COLORS[keyword] ?? KEYWORD_COLORS.CREATED;
    const date = parsed
      ? new Date(parsed.epochMs).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : this.annotation;
    return html`<span
      class="org-timestamp-badge"
      contenteditable="false"
      @click=${this.onClick}
      ><span class="org-timestamp-keyword" style="color: ${color};"
        >${label}</span
      ><span class="org-timestamp-date">${date}</span></span
    >`;
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
