import { Text } from '@blocksuite/store';
import { describe, expect, test } from 'vitest';

import { TableDataManager } from '../table-data-manager';

/** A table model as the data manager reads it, with cells as stored. */
const stubModel = (cells: Record<string, { text: unknown }>, readonly = false) =>
  ({
    store: { readonly, transact: (fn: () => void) => fn() },
    props: { cells, rows: {}, columns: {} },
  }) as any;

describe('repairPlainTextCells', () => {
  test('turns string cells, as the server wrote them, into Text', () => {
    const kept = new Text('Price');
    const model = stubModel({
      'r1:c1': { text: 'Model' },
      'r1:c2': { text: kept },
    });
    expect(new TableDataManager(model).repairPlainTextCells()).toBe(1);
    expect(model.props.cells['r1:c1'].text).toBeInstanceOf(Text);
    // Detached from a doc, a Text reads back only once attached; its length is set.
    expect(model.props.cells['r1:c1'].text.length).toBe('Model'.length);
    expect(model.props.cells['r1:c2'].text).toBe(kept);
  });

  test('leaves a read-only table and an already-Text table alone', () => {
    const readonly = stubModel({ 'r1:c1': { text: 'Model' } }, true);
    expect(new TableDataManager(readonly).repairPlainTextCells()).toBe(0);
    expect(readonly.props.cells['r1:c1'].text).toBe('Model');

    const fine = stubModel({ 'r1:c1': { text: new Text('A') } });
    expect(new TableDataManager(fine).repairPlainTextCells()).toBe(0);
  });
});
