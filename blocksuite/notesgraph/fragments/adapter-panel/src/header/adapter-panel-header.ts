import { SignalWatcher } from '@blocksuite/global/lit';
import { ArrowDownSmallIcon, FlipDirectionIcon } from '@blocksuite/icons/lit';
import { createLitPortal } from '@blocksuite/notesgraph-components/portal';
import { flip, offset } from '@floating-ui/dom';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';

import { type AdapterPanelContext, adapterPanelContext } from '../config';

export const NOTESGRAPH_ADAPTER_PANEL_HEADER =
  'notesgraph-adapter-panel-header';

export class AdapterPanelHeader extends SignalWatcher(LitElement) {
  static override styles = css`
    .adapter-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--notesgraph-background-primary-color);
    }
    .adapter-selector {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid var(--notesgraph-border-color);
      padding: 4px 8px;
    }
    .adapter-selector:hover {
      background: var(--notesgraph-hover-color);
    }
    .adapter-selector-label {
      display: flex;
      align-items: center;
      color: var(--notesgraph-text-primary-color);
      font-size: var(--notesgraph-font-xs);
    }
    .update-button {
      height: 20px;
      width: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      cursor: pointer;
      color: var(--notesgraph-icon-color);
    }
    .update-button:hover {
      background-color: var(--notesgraph-hover-color);
    }
  `;

  get activeAdapter() {
    return this._context.activeAdapter$.value;
  }

  private _adapterMenuAbortController: AbortController | null = null;
  private readonly _toggleAdapterMenu = () => {
    if (this._adapterMenuAbortController) {
      this._adapterMenuAbortController.abort();
    }
    this._adapterMenuAbortController = new AbortController();

    createLitPortal({
      template: html`<notesgraph-adapter-menu
        .abortController=${this._adapterMenuAbortController}
      ></notesgraph-adapter-menu>`,
      portalStyles: {
        zIndex: 'var(--notesgraph-z-index-popover)',
      },
      container: this._adapterPanelHeader,
      computePosition: {
        referenceElement: this._adapterSelector,
        placement: 'bottom-start',
        middleware: [flip(), offset(4)],
        autoUpdate: { animationFrame: true },
      },
      abortController: this._adapterMenuAbortController,
      closeOnClickAway: true,
    });
  };

  override render() {
    return html`
      <div class="adapter-panel-header">
        <div class="adapter-selector" @click="${this._toggleAdapterMenu}">
          <span class="adapter-selector-label">
            ${this.activeAdapter.label}
          </span>
          ${ArrowDownSmallIcon({ width: '16px', height: '16px' })}
        </div>
        <div class="update-button" @click="${this.updateActiveContent}">
          ${FlipDirectionIcon({ width: '16px', height: '16px' })}
        </div>
      </div>
    `;
  }

  @query('.adapter-panel-header')
  private accessor _adapterPanelHeader!: HTMLDivElement;

  @query('.adapter-selector')
  private accessor _adapterSelector!: HTMLDivElement;

  @property({ attribute: false })
  accessor updateActiveContent: () => void = () => {};

  @consume({ context: adapterPanelContext })
  private accessor _context!: AdapterPanelContext;
}

declare global {
  interface HTMLElementTagNameMap {
    [NOTESGRAPH_ADAPTER_PANEL_HEADER]: AdapterPanelHeader;
  }
}
