import { WithDisposable } from '@blocksuite/global/lit';
import { ToggleDownIcon, ToggleRightIcon } from '@blocksuite/icons/lit';
import { unsafeCSSVarV2 } from '@blocksuite/notesgraph-shared/theme';
import { ShadowlessElement } from '@blocksuite/std';
import { css, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';
import { html } from 'lit-html';

export const TOGGLE_BUTTON_PARENT_CLASS = 'blocksuite-toggle-button-parent';

export class ToggleButton extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .toggle-icon {
      display: flex;
      align-items: start;
      justify-content: start;
      position: absolute;
      width: 16px;
      height: 16px;
      top: calc((1em - 16px) / 2 + 5px);
      left: 0;
      transform: translateX(-100%);
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    }

    .toggle-icon:hover {
      background: var(--notesgraph-hover-color);
    }

    .toggle-icon[data-collapsed='true'] {
      opacity: 1;
    }

    .${unsafeCSS(TOGGLE_BUTTON_PARENT_CLASS)}:hover .toggle-icon {
      opacity: 1;
    }

    .with-drag-handle .toggle-icon {
      opacity: 1;
    }
    .with-drag-handle .notesgraph-block-children-container .toggle-icon {
      opacity: 0;
    }

    .toggle-icon {
      svg {
        color: ${unsafeCSSVarV2('icon/primary', '#77757D')};
      }
    }

    /* A collapsed block shows a "…" pill after the end of its last line,
       past any inline dates and tags. A pseudo-element keeps it out of the
       text model, so the caret and copy/paste ignore it. */
    .${unsafeCSS(TOGGLE_BUTTON_PARENT_CLASS)}:has(
        > blocksuite-toggle-button .toggle-icon[data-collapsed='true']
      )
      > rich-text
      v-line:last-of-type
      > div::after {
      content: '…';
      display: inline-flex;
      align-items: center;
      padding: 0 6px;
      margin-left: 4px;
      border-radius: 8px;
      font-size: 0.78em;
      line-height: 1.6;
      vertical-align: baseline;
      user-select: none;
      cursor: pointer;
      color: var(--notesgraph-text-secondary-color);
      background: var(--notesgraph-hover-color, rgba(0, 0, 0, 0.04));
    }
  `;

  // The pill is a pseudo-element, so it has no click target of its own: a
  // click on the line element itself (not on a text span) that lands right of
  // the last glyph is a click on the pill.
  private readonly _onPillClick = (e: MouseEvent) => {
    if (!this.collapsed) return;
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.parentElement) return;
    const line = target.closest('v-line');
    if (!line || (target !== line && target.parentElement !== line)) return;
    const lastChild = target.lastElementChild ?? target;
    const textRight = lastChild.getBoundingClientRect().right;
    if (e.clientX < textRight) return;
    e.preventDefault();
    e.stopPropagation();
    this.updateCollapsed(false);
  };

  private _pillHost: Element | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._pillHost = this.closest(`.${TOGGLE_BUTTON_PARENT_CLASS}`);
    this._pillHost?.addEventListener('click', this._onPillClick, true);
  }

  override disconnectedCallback() {
    this._pillHost?.removeEventListener('click', this._onPillClick, true);
    this._pillHost = null;
    super.disconnectedCallback();
  }

  override render() {
    const toggleDownTemplate = html`
      <div
        contenteditable="false"
        class="toggle-icon"
        @click=${() => this.updateCollapsed(!this.collapsed)}
      >
        ${ToggleDownIcon({
          width: '16px',
          height: '16px',
        })}
      </div>
    `;

    const toggleRightTemplate = html`
      <div
        contenteditable="false"
        class="toggle-icon"
        data-collapsed=${this.collapsed}
        @click=${() => this.updateCollapsed(!this.collapsed)}
      >
        ${ToggleRightIcon({
          width: '16px',
          height: '16px',
        })}
      </div>
    `;

    return this.collapsed ? toggleRightTemplate : toggleDownTemplate;
  }

  @property({ attribute: false })
  accessor collapsed!: boolean;

  @property({ attribute: false })
  accessor updateCollapsed!: (collapsed: boolean) => void;
}

declare global {
  interface HTMLElementTagNameMap {
    'blocksuite-toggle-button': ToggleButton;
  }
}
