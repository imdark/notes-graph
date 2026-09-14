import { type FrameBlockModel } from '@blocksuite/notesgraph-model';
import { WidgetComponent, WidgetViewExtension } from '@blocksuite/std';
import { html } from 'lit';
import { literal, unsafeStatic } from 'lit/static-html.js';

export const NOTESGRAPH_FRAME_TITLE_WIDGET = 'notesgraph-frame-title-widget';

export class NotesGraphFrameTitleWidget extends WidgetComponent<FrameBlockModel> {
  override render() {
    return html`<notesgraph-frame-title
      .model=${this.model}
      data-id=${this.model.id}
    ></notesgraph-frame-title>`;
  }
}

export const frameTitleWidget = WidgetViewExtension(
  'notesgraph:frame',
  NOTESGRAPH_FRAME_TITLE_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_FRAME_TITLE_WIDGET)}`
);
