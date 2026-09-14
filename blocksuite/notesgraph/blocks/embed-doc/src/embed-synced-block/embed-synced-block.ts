import type { EmbedSyncedBlockModel } from '@blocksuite/notesgraph-model';
import { CaptionedBlockComponent } from '@blocksuite/notesgraph-components/caption';
import { createLitPortal } from '@blocksuite/notesgraph-components/portal';
import { DefaultInlineManagerExtension } from '@blocksuite/notesgraph-inline-preset';
import { RefNodeSlotsProvider } from '@blocksuite/notesgraph-inline-reference';
import {
  evaluateFormula,
  type FormulaValue,
} from '@blocksuite/notesgraph-shared/utils';
import type { BlockModel, Store } from '@blocksuite/store';
import { computed, effect, signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';

/**
 * Notion-style synced block: a live reference to a single block elsewhere
 * (possibly another doc). The body is a real rich-text bound to the source
 * block's own Y.Text — the same one-value-two-views binding the mirror
 * boards use — so edits flow both ways character-by-character with no copy
 * or sync loop. A hover frame marks it as synced, with a jump-to-original
 * affordance.
 */
export class EmbedSyncedBlockComponent extends CaptionedBlockComponent<EmbedSyncedBlockModel> {
  static override styles = css`
    notesgraph-embed-synced-block {
      display: block;
    }
    notesgraph-embed-synced-block .synced-block-frame {
      position: relative;
      border-radius: 4px;
      padding: 2px 6px;
      margin: 2px 0;
      border: 1px solid transparent;
      transition: border-color 0.15s ease;
    }
    notesgraph-embed-synced-block .synced-block-frame:hover {
      border-color: var(--affine-brand-color, #1e96eb);
    }
    notesgraph-embed-synced-block .synced-block-badge {
      position: absolute;
      top: -10px;
      right: 6px;
      display: none;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--affine-brand-color, #1e96eb);
      background: var(--affine-background-primary-color, #fff);
      padding: 0 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      z-index: 1;
    }
    notesgraph-embed-synced-block .synced-block-frame:hover .synced-block-badge {
      display: inline-flex;
    }
    notesgraph-embed-synced-block .synced-block-missing {
      color: var(--affine-text-secondary-color, #8e8d91);
      font-style: italic;
      padding: 2px 0;
    }
    notesgraph-embed-synced-block .synced-formula-value {
      padding: 2px 0;
    }
    notesgraph-embed-synced-block .synced-formula-value.error {
      color: var(--affine-error-color, #eb4335);
      font-style: italic;
    }
  `;

  private readonly sourceStore$ = computed<Store | null>(() => {
    const pageId = this.model.props.pageId$.value;
    if (!pageId) return null;
    if (pageId === this.store.id) return this.store;
    const doc = this.store.workspace.getDoc(pageId);
    if (!doc) return null;
    if (!doc.loaded) {
      try {
        doc.load();
      } catch (e) {
        console.error(e);
        return null;
      }
    }
    // stable id — bare getStore() would mint a fresh empty store per call
    return doc.getStore({ id: pageId });
  });

  private readonly sourceModel$ = computed<BlockModel | null>(() => {
    const store = this.sourceStore$.value;
    const blockId = this.model.props.blockId$.value;
    if (!store || !blockId) return null;
    return store.getBlock$(blockId)?.model ?? null;
  });

  /** Resolve any block address (cross-doc) to its store, loading if needed. */
  private resolveStore(pageId: string): Store | null {
    if (!pageId) return null;
    if (pageId === this.store.id) return this.store;
    const doc = this.store.workspace.getDoc(pageId);
    if (!doc) return null;
    if (!doc.loaded) {
      try {
        doc.load();
      } catch (e) {
        console.error(e);
        return null;
      }
    }
    return doc.getStore({ id: pageId });
  }

  private resolveModel(pageId: string, blockId: string): BlockModel | null {
    const store = this.resolveStore(pageId);
    if (!store || !blockId) return null;
    return store.getBlock$(blockId)?.model ?? null;
  }

  /** A referenced block's formula value: trimmed text, numeric when it reads as one. */
  private blockValue(pageId: string, blockId: string): FormulaValue {
    const text = this.resolveModel(pageId, blockId)?.text;
    if (!text) return null;
    const raw = text.toString().trim();
    if (raw === '') return null;
    const num = Number(raw);
    return Number.isNaN(num) ? raw : num;
  }

  /** The source block plus every extra ref, for live re-render observation. */
  private readonly observedModels$ = computed<BlockModel[]>(() => {
    const models: (BlockModel | null)[] = [this.sourceModel$.value];
    for (const ref of this.model.props.refs$.value ?? []) {
      models.push(this.resolveModel(ref.pageId, ref.blockId));
    }
    return models.filter((m): m is BlockModel => !!m);
  });

  get inlineManager() {
    return this.std.get(DefaultInlineManagerExtension.identifier);
  }

  /** Bumped on source text edits so computed formulas re-render live. */
  private readonly sourceTextVersion$ = signal(0);

  override connectedCallback() {
    super.connectedCallback();
    this.disposables.add(
      effect(() => {
        const texts = this.observedModels$.value
          .map(m => m.text)
          .filter((t): t is NonNullable<typeof t> => !!t);
        if (texts.length === 0) return;
        const handler = () => {
          this.sourceTextVersion$.value++;
        };
        texts.forEach(t => t.yText.observe(handler));
        return () => texts.forEach(t => t.yText.unobserve(handler));
      })
    );
  }

  private readonly openOriginal = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.std.getOptional(RefNodeSlotsProvider)?.docLinkClicked.next({
      pageId: this.model.props.pageId,
      params: { blockIds: [this.model.props.blockId] },
      host: this.host,
    });
  };

  /**
   * The source block's value for formulas: its trimmed plain text, as a
   * number when it reads as one.
   */
  private sourceValue(): FormulaValue {
    const text = this.sourceModel$.value?.text;
    if (!text) return null;
    const raw = text.toString().trim();
    if (raw === '') return null;
    const num = Number(raw);
    return Number.isNaN(num) ? raw : num;
  }

  private _formulaEditorAbort: AbortController | null = null;

  /** A short human label for a referenced block (its current text). */
  refLabel(pageId: string, blockId: string): string {
    const text = this.resolveModel(pageId, blockId)?.text?.toString().trim();
    return text ? text.slice(0, 40) : 'block';
  }

  private readonly editFormula = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.store.readonly) return;

    this._formulaEditorAbort?.abort();
    this._formulaEditorAbort = new AbortController();
    createLitPortal({
      template: html`<notesgraph-synced-formula-editor
        .block=${this}
        .abortController=${this._formulaEditorAbort}
      ></notesgraph-synced-formula-editor>`,
      container: this.host,
      computePosition: {
        referenceElement: event.currentTarget as HTMLElement,
        placement: 'bottom-start',
        autoUpdate: { animationFrame: true },
      },
      closeOnClickAway: true,
      abortController: this._formulaEditorAbort,
      shadowDom: false,
      portalStyles: {
        zIndex: 'var(--notesgraph-z-index-popover)',
      },
    });
  };

  /** Persist the formula editor's expression + refs onto the model. */
  saveFormula(expression: string, refs: EmbedSyncedBlockModel['props']['refs']) {
    this.store.captureSync();
    this.model.props.expression = expression.trim() ? expression : null;
    this.model.props.refs = refs && refs.length ? refs : [];
  }

  private renderBadges() {
    return html`
      <span
        class="synced-block-badge"
        style="right: 76px;"
        contenteditable="false"
        data-testid="synced-block-formula"
        @click=${this.editFormula}
        >ƒ</span
      >
      <span
        class="synced-block-badge"
        contenteditable="false"
        @click=${this.openOriginal}
        >SYNCED ↗</span
      >
    `;
  }

  override renderBlock() {
    const source = this.sourceModel$.value;
    const sourceText = source?.text;

    if (!source || !sourceText) {
      return html`
        <div class="synced-block-frame">
          <div class="synced-block-missing">
            Synced block — original was deleted or is unavailable
          </div>
        </div>
      `;
    }

    // Synced formula: this block's value is a live function of the source
    // block's value — `value + 15` renders source-plus-fifteen and tracks
    // every edit to the source.
    const expression = this.model.props.expression$.value?.trim();
    if (expression) {
      this.sourceTextVersion$.value;
      const refs = this.model.props.refs$.value ?? [];
      const result = evaluateFormula(expression, name => {
        const key = name.trim().toLowerCase();
        if (key === 'value') return this.sourceValue();
        const ref = refs.find(r => r.name.trim().toLowerCase() === key);
        if (ref) return this.blockValue(ref.pageId, ref.blockId);
        throw new Error(`unknown reference '${name}'`);
      });
      const isError = typeof result === 'string' && result.startsWith('#ERR');
      return html`
        <div class="synced-block-frame" contenteditable="false">
          ${this.renderBadges()}
          <div
            class="synced-formula-value ${isError ? 'error' : ''}"
            title=${isError ? result : `= ${expression}`}
            data-testid="synced-formula-value"
          >
            ${result == null ? '' : String(result)}
          </div>
        </div>
      `;
    }

    const sourceStore = this.sourceStore$.value;
    const readonly = this.store.readonly || (sourceStore?.readonly ?? true);

    return html`
      <div class="synced-block-frame">
        ${this.renderBadges()}
        <rich-text
          .yText=${sourceText.yText}
          .inlineEventSource=${this.topContenteditableElement ?? nothing}
          .undoManager=${sourceStore?.history.undoManager}
          .attributeRenderer=${this.inlineManager.getRenderer()}
          .attributesSchema=${this.inlineManager.getSchema()}
          .embedChecker=${this.inlineManager.embedChecker}
          .markdownMatches=${this.inlineManager.markdownMatches}
          .readonly=${readonly}
          .enableClipboard=${true}
          .enableUndoRedo=${true}
        ></rich-text>
      </div>
    `;
  }

  override accessor blockContainerStyles = { margin: '10px 0' };
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-embed-synced-block': EmbedSyncedBlockComponent;
  }
}
