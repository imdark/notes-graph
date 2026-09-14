import { SizeDropdownMenu } from './dropdown-menu';

export * from './dropdown-menu';

export function effects() {
  customElements.define('notesgraph-size-dropdown-menu', SizeDropdownMenu);
}
