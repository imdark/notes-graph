import {
  NOTESGRAPH_KEYBOARD_TOOLBAR_WIDGET,
  NotesGraphKeyboardToolbarWidget,
} from './index.js';
import {
  NOTESGRAPH_KEYBOARD_TOOL_PANEL,
  NotesGraphKeyboardToolPanel,
} from './keyboard-tool-panel.js';
import {
  NOTESGRAPH_KEYBOARD_TOOLBAR,
  NotesGraphKeyboardToolbar,
} from './keyboard-toolbar.js';

export function effects() {
  customElements.define(
    NOTESGRAPH_KEYBOARD_TOOLBAR_WIDGET,
    NotesGraphKeyboardToolbarWidget
  );
  customElements.define(NOTESGRAPH_KEYBOARD_TOOLBAR, NotesGraphKeyboardToolbar);
  customElements.define(
    NOTESGRAPH_KEYBOARD_TOOL_PANEL,
    NotesGraphKeyboardToolPanel
  );
}

declare global {
  interface HTMLElementTagNameMap {
    [NOTESGRAPH_KEYBOARD_TOOLBAR]: NotesGraphKeyboardToolbar;
    [NOTESGRAPH_KEYBOARD_TOOL_PANEL]: NotesGraphKeyboardToolPanel;
  }
}
