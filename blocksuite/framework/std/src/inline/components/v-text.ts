import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { ZERO_WIDTH_FOR_EMPTY_LINE } from '../consts.js';

export class VText extends LitElement {
  override createRenderRoot() {
    return this;
  }

  override render() {
    // we need to avoid \n appearing before and after the span element, which will
    // cause the sync problem about the cursor position
    //
    // `white-space: break-spaces` first is the fallback for engines without
    // the `white-space-collapse` longhand (Chrome < 114, so older Android
    // WebViews; Safari < 17.4). There the longhand is dropped, whitespace
    // collapses, and a space typed at the end of a line is neither rendered
    // nor reported to the IME: Gboard re-composes the word before it and the
    // edit deletes the space ("now please" became "nowplease ").
    return html`<span
      style=${styleMap({
        'white-space': 'break-spaces',
        'word-break': 'break-word',
        'text-wrap': 'wrap',
        'white-space-collapse': 'break-spaces',
      })}
      data-v-text="true"
      >${this.str}</span
    >`;
  }

  @property({ attribute: false })
  accessor str: string = ZERO_WIDTH_FOR_EMPTY_LINE;
}

declare global {
  interface HTMLElementTagNameMap {
    'v-text': VText;
  }
}
