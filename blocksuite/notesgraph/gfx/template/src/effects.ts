import { OverlayScrollbar } from './toolbar/overlay-scrollbar';
import { NotesGraphTemplateLoading } from './toolbar/template-loading';
import { EdgelessTemplatePanel } from './toolbar/template-panel';
import { EdgelessTemplateButton } from './toolbar/template-tool-button';

export function effects() {
  customElements.define('edgeless-templates-panel', EdgelessTemplatePanel);
  customElements.define('overlay-scrollbar', OverlayScrollbar);
  customElements.define('edgeless-template-button', EdgelessTemplateButton);
  customElements.define(
    'notesgraph-template-loading',
    NotesGraphTemplateLoading
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-templates-panel': EdgelessTemplatePanel;
    'overlay-scrollbar': OverlayScrollbar;
    'edgeless-template-button': EdgelessTemplateButton;
    'notesgraph-template-loading': NotesGraphTemplateLoading;
  }
}
