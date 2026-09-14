import zod from 'zod';

import { t } from '../../core/index.js';
import { propertyType } from '../../core/property/property-config.js';

export const relationPropertyType = propertyType('relation');

/**
 * A relation column: its value is a set of references (row ids) to other rows
 * in the same table. Used, among other things, to record task dependencies for
 * the Gantt view ("this task depends on those tasks"). Titles are resolved at
 * render time by the cell renderer, so the stored value is just the ids.
 */
export const relationPropertyModelConfig = relationPropertyType.modelConfig({
  name: 'Relation',
  propertyData: {
    schema: zod.object({}),
    default: () => ({}),
  },
  jsonValue: {
    schema: zod.array(zod.string()),
    isEmpty: ({ value }) => !Array.isArray(value) || value.length === 0,
    type: () => t.array.instance(t.string.instance()),
  },
  rawValue: {
    schema: zod.array(zod.string()),
    default: () => [],
    // We can't resolve row titles here (no data source in scope), so round-trip
    // the raw row ids — lossless for copy/paste within the same table.
    toString: ({ value }) => (Array.isArray(value) ? value.join(',') : ''),
    fromString: ({ value }) => {
      const ids = value
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);
      return { value: ids };
    },
    toJson: ({ value }) => value ?? null,
    fromJson: ({ value }) =>
      Array.isArray(value) && value.every(v => typeof v === 'string')
        ? value
        : undefined,
  },
});
