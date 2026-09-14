import { CodeBlockComponent } from './code-block';
import {
  NOTESGRAPH_CODE_TOOLBAR_WIDGET,
  NotesGraphCodeToolbarWidget,
} from './code-toolbar';
import { NotesGraphCodeToolbar } from './code-toolbar/components/code-toolbar';
import { LanguageListButton } from './code-toolbar/components/lang-button';
import { NotesGraphCodeMoreMenu } from './code-toolbar/components/more-menu';
import { PreviewButton } from './code-toolbar/components/preview-button';
import { NotesGraphCodeUnit } from './highlight/notesgraph-code-unit';

export function effects() {
  customElements.define('language-list-button', LanguageListButton);
  customElements.define('notesgraph-code-toolbar', NotesGraphCodeToolbar);
  customElements.define('notesgraph-code-more-menu', NotesGraphCodeMoreMenu);
  customElements.define(
    NOTESGRAPH_CODE_TOOLBAR_WIDGET,
    NotesGraphCodeToolbarWidget
  );
  customElements.define('notesgraph-code-unit', NotesGraphCodeUnit);
  customElements.define('notesgraph-code', CodeBlockComponent);
  customElements.define('preview-button', PreviewButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'language-list-button': LanguageListButton;
    'notesgraph-code-toolbar': NotesGraphCodeToolbar;
    'notesgraph-code-more-menu': NotesGraphCodeMoreMenu;
    'preview-button': PreviewButton;
    [NOTESGRAPH_CODE_TOOLBAR_WIDGET]: NotesGraphCodeToolbarWidget;
  }
}
