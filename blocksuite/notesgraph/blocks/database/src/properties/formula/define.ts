import { propertyType, t } from '@blocksuite/data-view';
import zod from 'zod';

export const formulaColumnType = propertyType('formula');

export const formulaPropertyModelConfig = formulaColumnType.modelConfig({
  name: 'Formula',
  propertyData: {
    schema: zod.object({
      expression: zod.string().default(''),
    }),
    default: () => ({ expression: '' }),
  },
  jsonValue: {
    schema: zod.union([zod.string(), zod.number(), zod.boolean()]).nullable(),
    isEmpty: ({ value }) => value == null || value === '',
    type: () => t.string.instance(),
  },
  rawValue: {
    // The value is computed per row by the data source (see
    // DatabaseBlockDataSource.cellValueGet); nothing is stored in cells.
    schema: zod.union([zod.string(), zod.number(), zod.boolean()]).nullable(),
    default: () => null,
    toString: ({ value }) => (value == null ? '' : String(value)),
    fromString: () => ({ value: null }),
    toJson: ({ value }) => value,
    setValue: () => {},
  },
});
