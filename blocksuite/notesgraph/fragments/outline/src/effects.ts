import {
  NOTESGRAPH_OUTLINE_NOTICE,
  OutlineNotice,
} from './body/outline-notice';
import {
  NOTESGRAPH_OUTLINE_PANEL_BODY,
  OutlinePanelBody,
} from './body/outline-panel-body';
import {
  NOTESGRAPH_OUTLINE_NOTE_CARD,
  OutlineNoteCard,
} from './card/outline-card';
import {
  NOTESGRAPH_OUTLINE_BLOCK_PREVIEW,
  OutlineBlockPreview,
} from './card/outline-preview';
import {
  NOTESGRAPH_OUTLINE_PANEL_HEADER,
  OutlinePanelHeader,
} from './header/outline-panel-header';
import {
  NOTESGRAPH_OUTLINE_NOTE_PREVIEW_SETTING_MENU,
  OutlineNotePreviewSettingMenu,
} from './header/outline-setting-menu';
import {
  MobileOutlineMenu,
  NOTESGRAPH_MOBILE_OUTLINE_MENU,
} from './mobile-outline-panel';
import { NOTESGRAPH_OUTLINE_PANEL, OutlinePanel } from './outline-panel';
import { NOTESGRAPH_OUTLINE_VIEWER, OutlineViewer } from './outline-viewer';

export function effects() {
  customElements.define(
    NOTESGRAPH_OUTLINE_NOTE_PREVIEW_SETTING_MENU,
    OutlineNotePreviewSettingMenu
  );
  customElements.define(NOTESGRAPH_OUTLINE_NOTICE, OutlineNotice);
  customElements.define(NOTESGRAPH_OUTLINE_PANEL, OutlinePanel);
  customElements.define(NOTESGRAPH_OUTLINE_PANEL_HEADER, OutlinePanelHeader);
  customElements.define(NOTESGRAPH_OUTLINE_NOTE_CARD, OutlineNoteCard);
  customElements.define(NOTESGRAPH_OUTLINE_VIEWER, OutlineViewer);
  customElements.define(NOTESGRAPH_MOBILE_OUTLINE_MENU, MobileOutlineMenu);
  customElements.define(NOTESGRAPH_OUTLINE_BLOCK_PREVIEW, OutlineBlockPreview);
  customElements.define(NOTESGRAPH_OUTLINE_PANEL_BODY, OutlinePanelBody);
}
