import { WithDisposable } from '@blocksuite/notesgraph/global/lit';
import type { ColorScheme } from '@blocksuite/notesgraph/model';
import { ShadowlessElement } from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import type { Signal } from '@preact/signals-core';
import { html } from 'lit';
import { property } from 'lit/decorators.js';

import { createTextRenderer } from '../../components/text-renderer';

export class ChatContentRichText extends WithDisposable(ShadowlessElement) {
  @property({ attribute: false })
  accessor text!: string;

  @property({ attribute: false })
  accessor state: 'finished' | 'generating' = 'finished';

  @property({ attribute: false })
  accessor extensions!: ExtensionType[];

  @property({ attribute: false })
  accessor notesgraphFeatureFlagService!: FeatureFlagService;

  @property({ attribute: false })
  accessor theme!: Signal<ColorScheme>;

  protected override render() {
    const { text } = this;
    return html`${createTextRenderer({
      customHeading: true,
      extensions: this.extensions,
      notesgraphFeatureFlagService: this.notesgraphFeatureFlagService,
      theme: this.theme,
      scrollable: false,
    })(text, this.state)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chat-content-rich-text': ChatContentRichText;
  }
}
