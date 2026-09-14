import type { TestNotesGraphEditorContainer } from '@blocksuite/integration-test';
import { WithDisposable } from '@blocksuite/notesgraph/global/lit';
import { ShadowlessElement } from '@blocksuite/notesgraph/std';
import { effect } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('custom-frame-panel')
export class CustomFramePanel extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .custom-frame-container {
      position: absolute;
      top: 0;
      right: 0;
      border: 1px solid var(--notesgraph-border-color, #e3e2e4);
      background-color: var(--notesgraph-background-primary-color);
      height: 100vh;
      width: 320px;
      box-sizing: border-box;
      padding-top: 16px;
      z-index: 1;
    }
  `;

  private _renderPanel() {
    return html`<notesgraph-frame-panel
      .host=${this.editor.std.host}
    ></notesgraph-frame-panel>`;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    this.disposables.add(
      effect(() => {
        const std = this.editor.std;
        if (std) {
          this.editor.updateComplete
            .then(() => this.requestUpdate())
            .catch(console.error);
        }
      })
    );
  }

  override render() {
    return html`
      ${this._show
        ? html`<div class="custom-frame-container">${this._renderPanel()}</div>`
        : nothing}
    `;
  }

  toggleDisplay() {
    this._show = !this._show;
  }

  @state()
  private accessor _show = false;

  @property({ attribute: false })
  accessor editor!: TestNotesGraphEditorContainer;
}

declare global {
  interface HTMLElementTagNameMap {
    'custom-frame-panel': CustomFramePanel;
  }
}
