import {
  FramePanelBody,
  NOTESGRAPH_FRAME_PANEL_BODY,
} from './body/frame-panel-body';
import { FrameCard, NOTESGRAPH_FRAME_CARD } from './card/frame-card';
import {
  FrameCardTitle,
  NOTESGRAPH_FRAME_CARD_TITLE,
} from './card/frame-card-title';
import {
  FrameCardTitleEditor,
  NOTESGRAPH_FRAME_TITLE_EDITOR,
} from './card/frame-card-title-editor';
import { FramePreview, NOTESGRAPH_FRAME_PREVIEW } from './card/frame-preview';
import { FramePanel, NOTESGRAPH_FRAME_PANEL } from './frame-panel';
import {
  FramePanelHeader,
  NOTESGRAPH_FRAME_PANEL_HEADER,
} from './header/frame-panel-header';
import {
  FramesSettingMenu,
  NOTESGRAPH_FRAMES_SETTING_MENU,
} from './header/frames-setting-menu';

export function effects() {
  customElements.define(NOTESGRAPH_FRAME_PANEL, FramePanel);
  customElements.define(NOTESGRAPH_FRAME_TITLE_EDITOR, FrameCardTitleEditor);
  customElements.define(NOTESGRAPH_FRAME_CARD, FrameCard);
  customElements.define(NOTESGRAPH_FRAME_CARD_TITLE, FrameCardTitle);
  customElements.define(NOTESGRAPH_FRAME_PANEL_BODY, FramePanelBody);
  customElements.define(NOTESGRAPH_FRAME_PANEL_HEADER, FramePanelHeader);
  customElements.define(NOTESGRAPH_FRAMES_SETTING_MENU, FramesSettingMenu);
  customElements.define(NOTESGRAPH_FRAME_PREVIEW, FramePreview);
}
