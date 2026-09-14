import { WithDisposable } from '@blocksuite/global/lit';
import type { SyncedBlockRef } from '@blocksuite/notesgraph-model';
import {
  parseSyncedBlockHtml,
  type SyncedBlockClipboardPayload,
} from '@blocksuite/notesgraph-shared/utils';
import { ShadowlessElement } from '@blocksuite/std';
import { css, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type { EmbedSyncedBlockComponent } from './embed-synced-block.js';

/** Formula functions offered by the autocomplete (see formula-eval.ts). */
const FORMULA_FUNCTIONS = [
  'now()',
  'today()',
  'days(',
  'hours(',
  'daysUntil(',
  'daysSince(',
  'round(',
  'floor(',
  'ceil(',
  'abs(',
  'min(',
  'max(',
  'len(',
  'lower(',
  'upper(',
  'concat(',
  'empty(',
  'if(',
];

type Suggestion = {
  /** Text inserted into the expression. */
  insert: string;
  /** Primary label shown in the dropdown. */
  label: string;
  /** Secondary hint (e.g. a referenced block's text). */
  hint?: string;
  kind: 'ref' | 'fn';
};

/**
 * The synced-formula editor popup: a textarea for the expression plus two
 * spreadsheet-like affordances the plain input lacked —
 *  1. **paste a copied block** ("Copy as synced block", then ⌘V here) to drop
 *     in a named `[refN]` reference to that block, and
 *  2. **autocomplete** that suggests the available references (`value`, every
 *     `[refN]`) and functions as you type.
 * Saves expression + refs back to the block on close.
 */
export class SyncedFormulaEditor extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    notesgraph-synced-formula-editor {
      display: block;
      width: 340px;
      max-width: 90vw;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--notesgraph-border-color);
      background: var(--notesgraph-background-overlay-panel-color);
      box-shadow: var(--notesgraph-shadow-2);
      font-size: var(--notesgraph-font-sm);
    }
    notesgraph-synced-formula-editor .sfe-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 48px;
      resize: vertical;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--notesgraph-border-color);
      background: var(--notesgraph-background-primary-color);
      color: var(--notesgraph-text-primary-color);
      font-family: var(--notesgraph-font-code-family, monospace);
      font-size: var(--notesgraph-font-sm);
      outline: none;
    }
    notesgraph-synced-formula-editor .sfe-suggest {
      margin-top: 4px;
      border: 1px solid var(--notesgraph-border-color);
      border-radius: 6px;
      overflow: hidden;
      max-height: 180px;
      overflow-y: auto;
    }
    notesgraph-synced-formula-editor .sfe-suggest-item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 5px 8px;
      cursor: pointer;
    }
    notesgraph-synced-formula-editor .sfe-suggest-item.active,
    notesgraph-synced-formula-editor .sfe-suggest-item:hover {
      background: var(--notesgraph-hover-color);
    }
    notesgraph-synced-formula-editor .sfe-suggest-label {
      font-family: var(--notesgraph-font-code-family, monospace);
      color: var(--notesgraph-text-primary-color);
    }
    notesgraph-synced-formula-editor .sfe-suggest-hint {
      color: var(--notesgraph-text-secondary-color);
      font-size: var(--notesgraph-font-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    notesgraph-synced-formula-editor .sfe-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    notesgraph-synced-formula-editor .sfe-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--notesgraph-border-color);
      background: var(--notesgraph-background-primary-color);
      color: var(--notesgraph-text-primary-color);
      cursor: pointer;
      font-size: var(--notesgraph-font-xs);
    }
    notesgraph-synced-formula-editor .sfe-btn:hover {
      background: var(--notesgraph-hover-color);
    }
    notesgraph-synced-formula-editor .sfe-spacer {
      flex: 1;
    }
    notesgraph-synced-formula-editor .sfe-refs {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
    }
    notesgraph-synced-formula-editor .sfe-ref {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--notesgraph-font-xs);
      color: var(--notesgraph-text-secondary-color);
    }
    notesgraph-synced-formula-editor .sfe-ref code {
      color: var(--notesgraph-text-primary-color);
    }
    notesgraph-synced-formula-editor .sfe-ref-remove {
      cursor: pointer;
      opacity: 0.6;
    }
    notesgraph-synced-formula-editor .sfe-ref-remove:hover {
      opacity: 1;
    }
    notesgraph-synced-formula-editor .sfe-hint {
      margin-top: 6px;
      color: var(--notesgraph-text-secondary-color);
      font-size: var(--notesgraph-font-xs);
    }
  `;

  @property({ attribute: false })
  accessor block!: EmbedSyncedBlockComponent;

  @property({ attribute: false })
  accessor abortController!: AbortController;

  @state()
  private accessor _expression = '';

  @state()
  private accessor _refs: SyncedBlockRef[] = [];

  @state()
  private accessor _suggestions: Suggestion[] = [];

  @state()
  private accessor _active = 0;

  @query('.sfe-input')
  private accessor _textarea!: HTMLTextAreaElement;

  override connectedCallback() {
    super.connectedCallback();
    this._expression = this.block.model.props.expression ?? '';
    this._refs = [...(this.block.model.props.refs ?? [])];
    // Persist on close (click-away / Escape / Done all abort the portal).
    this.abortController.signal.addEventListener(
      'abort',
      () => this.block.saveFormula(this._expression, this._refs),
      { once: true }
    );
  }

  override firstUpdated() {
    this._textarea?.focus();
    this._textarea?.setSelectionRange(
      this._expression.length,
      this._expression.length
    );
  }

  /** The word being typed just before the caret (may start with `[`). */
  private _currentToken(): { token: string; start: number } {
    const el = this._textarea;
    if (!el) return { token: '', start: 0 };
    const caret = el.selectionStart ?? this._expression.length;
    const before = this._expression.slice(0, caret);
    const match = /[[A-Za-z0-9_ ]*$/.exec(before);
    const token = match ? match[0] : '';
    return { token, start: caret - token.length };
  }

  private _refValue(token: string): Suggestion[] {
    const bare = token.replace(/^\[/, '').trim().toLowerCase();
    const items: Suggestion[] = [
      {
        insert: 'value',
        label: 'value',
        hint: 'the source block',
        kind: 'ref',
      },
      ...this._refs.map(ref => ({
        insert: `[${ref.name}]`,
        label: `[${ref.name}]`,
        hint: this.block.refLabel(ref.pageId, ref.blockId),
        kind: 'ref' as const,
      })),
    ];
    return items.filter(
      i => !bare || i.label.toLowerCase().includes(bare)
    );
  }

  private _fnSuggestions(token: string): Suggestion[] {
    const bare = token.replace(/^\[/, '').trim().toLowerCase();
    return FORMULA_FUNCTIONS.filter(
      fn => !bare || fn.toLowerCase().startsWith(bare)
    ).map(fn => ({ insert: fn, label: fn, kind: 'fn' as const }));
  }

  private _recomputeSuggestions() {
    const { token } = this._currentToken();
    if (token.trim() === '' && !token.startsWith('[')) {
      this._suggestions = [];
      return;
    }
    this._suggestions = [
      ...this._refValue(token),
      ...this._fnSuggestions(token),
    ];
    this._active = 0;
  }

  private _accept(s: Suggestion) {
    const { start, token } = this._currentToken();
    const end = start + token.length;
    const next =
      this._expression.slice(0, start) + s.insert + this._expression.slice(end);
    this._expression = next;
    this._suggestions = [];
    // Restore focus + caret after the inserted text.
    this.updateComplete
      .then(() => {
        const caret = start + s.insert.length;
        this._textarea?.focus();
        this._textarea?.setSelectionRange(caret, caret);
      })
      .catch(() => {});
  }

  private readonly _onInput = (e: Event) => {
    this._expression = (e.target as HTMLTextAreaElement).value;
    this._recomputeSuggestions();
  };

  private readonly _onKeydown = (e: KeyboardEvent) => {
    if (this._suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._active = (this._active + 1) % this._suggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._active =
          (this._active - 1 + this._suggestions.length) %
          this._suggestions.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const s = this._suggestions[this._active];
        if (s) {
          e.preventDefault();
          this._accept(s);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._suggestions = [];
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.abortController.abort();
    }
  };

  private _uniqueRefName(): string {
    let i = this._refs.length + 1;
    const names = new Set(this._refs.map(r => r.name));
    while (names.has(`ref${i}`)) i++;
    return `ref${i}`;
  }

  private _addRefAndInsert(payload: SyncedBlockClipboardPayload) {
    const existing = this._refs.find(
      r => r.pageId === payload.pageId && r.blockId === payload.blockId
    );
    const name = existing ? existing.name : this._uniqueRefName();
    if (!existing) {
      this._refs = [...this._refs, { name, ...payload }];
    }
    const el = this._textarea;
    const caret = el?.selectionStart ?? this._expression.length;
    const insert = `[${name}]`;
    this._expression =
      this._expression.slice(0, caret) +
      insert +
      this._expression.slice(caret);
    this._suggestions = [];
    this.updateComplete
      .then(() => {
        const pos = caret + insert.length;
        this._textarea?.focus();
        this._textarea?.setSelectionRange(pos, pos);
      })
      .catch(() => {});
  }

  private readonly _onPaste = (e: ClipboardEvent) => {
    const html = e.clipboardData?.getData('text/html');
    const payload = parseSyncedBlockHtml(html);
    if (payload) {
      // A copied block landed in the formula — drop in a ref, not its text.
      e.preventDefault();
      this._addRefAndInsert(payload);
    }
  };

  private readonly _pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        const blob = await item.getType('text/html');
        const payload = parseSyncedBlockHtml(await blob.text());
        if (payload) {
          this._addRefAndInsert(payload);
          return;
        }
      }
    } catch {
      // clipboard read blocked or empty — no-op
    }
  };

  private _removeRef(name: string) {
    this._refs = this._refs.filter(r => r.name !== name);
  }

  override render() {
    return html`
      <textarea
        class="sfe-input"
        .value=${this._expression}
        placeholder="value + [ref1]  ·  paste a copied block to add a reference"
        spellcheck="false"
        @input=${this._onInput}
        @keydown=${this._onKeydown}
        @paste=${this._onPaste}
      ></textarea>
      ${this._suggestions.length
        ? html`<div class="sfe-suggest">
            ${repeat(
              this._suggestions,
              (s, i) => `${s.kind}:${s.insert}:${i}`,
              (s, i) => html`<div
                class="sfe-suggest-item ${i === this._active ? 'active' : ''}"
                @mousedown=${(e: Event) => {
                  e.preventDefault();
                  this._accept(s);
                }}
              >
                <span class="sfe-suggest-label">${s.label}</span>
                ${s.hint
                  ? html`<span class="sfe-suggest-hint">${s.hint}</span>`
                  : nothing}
              </div>`
            )}
          </div>`
        : nothing}
      <div class="sfe-row">
        <span
          class="sfe-btn"
          @click=${this._pasteFromClipboard}
          title="Paste a block copied with 'Copy as synced block'"
          >＋ Reference a block</span
        >
        <span class="sfe-spacer"></span>
        <span class="sfe-btn" @click=${() => this.abortController.abort()}
          >Done</span
        >
      </div>
      ${this._refs.length
        ? html`<div class="sfe-refs">
            ${repeat(
              this._refs,
              r => r.name,
              r => html`<div class="sfe-ref">
                <code>[${r.name}]</code>
                <span class="sfe-suggest-hint"
                  >${this.block.refLabel(r.pageId, r.blockId)}</span
                >
                <span class="sfe-spacer"></span>
                <span
                  class="sfe-ref-remove"
                  @click=${() => this._removeRef(r.name)}
                  >✕</span
                >
              </div>`
            )}
          </div>`
        : html`<div class="sfe-hint">
            Refer to the source with <code>value</code>. Paste a copied block
            to add more (<code>[ref1]</code>). e.g.
            <code>value + [ref1]</code>
          </div>`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-synced-formula-editor': SyncedFormulaEditor;
  }
}
