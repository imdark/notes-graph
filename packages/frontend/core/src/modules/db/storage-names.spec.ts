import { expect, test } from 'vitest';

import { tableStorageName } from './storage-names';

test('a cloud workspace keeps doc properties in the rebuilt table', () => {
  expect(tableStorageName('docProperties', true)).toBe('docProperties2');
});

test('a local workspace, with no server to copy its rows, keeps the table where it is', () => {
  expect(tableStorageName('docProperties', false)).toBe('docProperties');
});

test('other tables are stored under their own name', () => {
  expect(tableStorageName('folders', true)).toBe('folders');
  expect(tableStorageName('folders', false)).toBe('folders');
});
