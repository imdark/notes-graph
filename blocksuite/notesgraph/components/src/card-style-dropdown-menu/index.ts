import { CardStyleDropdownMenu } from './dropdown-menu';

export * from './dropdown-menu';

export function effects() {
  customElements.define(
    'notesgraph-card-style-dropdown-menu',
    CardStyleDropdownMenu
  );
}
