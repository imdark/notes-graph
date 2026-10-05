import { NotesGraphSchemas } from '@blocksuite/notesgraph/schemas';
import { Schema } from '@blocksuite/notesgraph/store';
import { describe, expect, test } from 'vitest';

import {
  DashboardBlockFlavour,
  DashboardBlockSchema,
  WidgetBlockFlavour,
  WidgetBlockSchema,
} from './model';

const schema = new Schema();
schema.register([
  ...NotesGraphSchemas,
  DashboardBlockSchema,
  WidgetBlockSchema,
]);

describe('dashboard schema', () => {
  test('a dashboard and a chart sit in a note', () => {
    expect(schema.isValid(DashboardBlockFlavour, 'notesgraph:note')).toBe(true);
    expect(schema.isValid(WidgetBlockFlavour, 'notesgraph:note')).toBe(true);
  });

  test('text, lists, callouts, images and charts are tiles', () => {
    for (const flavour of [
      'notesgraph:paragraph',
      'notesgraph:list',
      'notesgraph:callout',
      'notesgraph:code',
      'notesgraph:image',
      'notesgraph:bookmark',
      WidgetBlockFlavour,
    ]) {
      expect(schema.isValid(flavour, DashboardBlockFlavour), flavour).toBe(
        true
      );
    }
  });

  test('dashboards and databases do not nest in a dashboard', () => {
    expect(schema.isValid(DashboardBlockFlavour, DashboardBlockFlavour)).toBe(
      false
    );
    expect(schema.isValid('notesgraph:database', DashboardBlockFlavour)).toBe(
      false
    );
  });
});
