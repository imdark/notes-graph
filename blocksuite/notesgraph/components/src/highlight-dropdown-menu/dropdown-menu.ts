import type { NotesGraphTextStyleAttributes } from '@blocksuite/notesgraph-shared/types';
import { PropTypes, requiredProperties } from '@blocksuite/std';
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { html } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';

import { EditorChevronDown } from '../toolbar';

const colors = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'grey',
] as const;

export type HighlightType = Pick<
  NotesGraphTextStyleAttributes,
  'color' | 'background'
>;

// TODO(@fundon): these recent settings should be added to the dropdown menu
// tests/blocksutie/e2e/format-bar.spec.ts#253
//
// let latestHighlightColor: string | null = null;
// let latestHighlightType: HighlightType = 'background';

@requiredProperties({
  updateHighlight: PropTypes.instanceOf(Function),
})
export class HighlightDropdownMenu extends LitElement {
  @property({ attribute: false })
  accessor updateHighlight!: (styles: HighlightType) => void;

  private readonly _update = (style: HighlightType) => {
    // latestHighlightColor = value;
    // latestHighlightType = type;

    this.updateHighlight(style);
  };

  override render() {
    const prefix = '--notesgraph-text-highlight';

    return html`
      <editor-menu-button
        .contentPadding="${'8px'}"
        .button=${html`
          <editor-icon-button aria-label="highlight" .tooltip="${'Highlight'}">
            <notesgraph-highlight-duotone-icon
              style=${styleMap({
                '--color':
                  // latestHighlightColor ?? 'var(--notesgraph-text-primary-color)',
                  'var(--notesgraph-text-primary-color)',
              })}
            ></notesgraph-highlight-duotone-icon>
            ${EditorChevronDown}
          </editor-icon-button>
        `}
      >
        <div data-size="large" data-orientation="vertical">
          <div class="highlight-heading">Color</div>
          ${repeat(colors, color => {
            const isDefault = color === 'default';
            const value = isDefault
              ? null
              : `var(${prefix}-foreground-${color})`;
            return html`
              <editor-menu-action
                data-testid="foreground-${color}"
                @click=${() => this._update({ color: value })}
              >
                <notesgraph-text-duotone-icon
                  style=${styleMap({
                    '--color': value ?? 'var(--notesgraph-text-primary-color)',
                  })}
                ></notesgraph-text-duotone-icon>
                <span class="label capitalize"
                  >${isDefault ? `${color} color` : color}</span
                >
              </editor-menu-action>
            `;
          })}

          <div class="highlight-heading">Background</div>
          ${repeat(colors, color => {
            const isDefault = color === 'default';
            const value = isDefault ? null : `var(${prefix}-${color})`;
            return html`
              <editor-menu-action
                data-testid="background-${color}"
                @click=${() => this._update({ background: value })}
              >
                <notesgraph-text-duotone-icon
                  style=${styleMap({
                    '--color': 'var(--notesgraph-text-primary-color)',
                    '--background': value ?? 'transparent',
                  })}
                ></notesgraph-text-duotone-icon>

                <span class="label capitalize"
                  >${isDefault ? `${color} background` : color}</span
                >
              </editor-menu-action>
            `;
          })}
        </div>
      </editor-menu-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-highlight-dropdown-menu': HighlightDropdownMenu;
  }
}
