import { CheckboxCell } from './checkbox/cell-renderer.js';
import { DateCell } from './date/cell-renderer.js';
import { ImageCell } from './image/cell-renderer.js';
import { MultiSelectCell } from './multi-select/cell-renderer.js';
import { NumberCell } from './number/cell-renderer.js';
import { ProgressCell } from './progress/cell-renderer.js';
import { RelationCell } from './relation/cell-renderer.js';
import { SelectCell } from './select/cell-renderer.js';
import { TextCell } from './text/cell-renderer.js';

export function propertyPresetsEffects() {
  customElements.define('notesgraph-database-checkbox-cell', CheckboxCell);
  customElements.define('notesgraph-database-date-cell', DateCell);
  customElements.define('notesgraph-database-image-cell', ImageCell);
  customElements.define(
    'notesgraph-database-multi-select-cell',
    MultiSelectCell
  );
  customElements.define('notesgraph-database-number-cell', NumberCell);
  customElements.define('notesgraph-database-progress-cell', ProgressCell);
  customElements.define('notesgraph-database-relation-cell', RelationCell);
  customElements.define('notesgraph-database-select-cell', SelectCell);
  customElements.define('notesgraph-database-text-cell', TextCell);
}
