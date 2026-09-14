import { Tooltip } from './tooltip.js';

export function effects() {
  if (!customElements.get('notesgraph-tooltip')) {
    customElements.define('notesgraph-tooltip', Tooltip);
  }
}
