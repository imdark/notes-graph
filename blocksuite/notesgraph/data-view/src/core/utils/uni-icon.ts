import * as icons from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import { uniMap } from './uni-component/operation.js';
import { createUniComponentFromWebComponent } from './uni-component/uni-component.js';

export class NotesGraphLitIcon extends ShadowlessElement {
  static override styles = css`
    notesgraph-lit-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    notesgraph-lit-icon svg {
      fill: var(--notesgraph-icon-color);
    }
  `;

  protected override render(): unknown {
    const createIcon = icons[this.name] as () => TemplateResult;
    return html`${createIcon?.()}`;
  }

  @property({ attribute: false })
  accessor name!: keyof typeof icons;
}

const litIcon = createUniComponentFromWebComponent<{ name: string }>(
  NotesGraphLitIcon
);
export const createIcon = (name: keyof typeof icons) => {
  return uniMap(litIcon, () => ({ name }));
};
