import { OpenDocDropdownMenu } from './dropdown-menu';

export * from './dropdown-menu';

export function effects() {
  customElements.define(
    'notesgraph-open-doc-dropdown-menu',
    OpenDocDropdownMenu
  );
}
