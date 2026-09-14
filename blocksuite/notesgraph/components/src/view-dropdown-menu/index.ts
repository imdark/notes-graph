import { ViewDropdownMenu } from './dropdown-menu';

export * from './dropdown-menu';

export function effects() {
  customElements.define('notesgraph-view-dropdown-menu', ViewDropdownMenu);
}
