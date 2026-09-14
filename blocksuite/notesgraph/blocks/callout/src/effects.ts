import { CalloutBlockComponent } from './callout-block';
import { IconPickerWrapper } from './icon-picker-wrapper';

export function effects() {
  customElements.define('notesgraph-callout', CalloutBlockComponent);
  customElements.define('icon-picker-wrapper', IconPickerWrapper);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-callout': CalloutBlockComponent;
    'icon-picker-wrapper': IconPickerWrapper;
  }
}
