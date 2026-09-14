import { NOTESGRAPH_SLASH_MENU_WIDGET } from './consts';
import { InnerSlashMenu, SlashMenu } from './slash-menu-popover';
import { NotesGraphSlashMenuWidget } from './widget';

export function effects() {
  customElements.define(
    NOTESGRAPH_SLASH_MENU_WIDGET,
    NotesGraphSlashMenuWidget
  );
  customElements.define('notesgraph-slash-menu', SlashMenu);
  customElements.define('inner-slash-menu', InnerSlashMenu);
}

declare global {
  interface HTMLElementTagNameMap {
    [NOTESGRAPH_SLASH_MENU_WIDGET]: NotesGraphSlashMenuWidget;
  }
}
