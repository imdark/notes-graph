import { createMemoryHistory } from 'history';
import { describe, expect, test } from 'vitest';

import { isSameLocation } from './same-location';

const at = (path: string) =>
  createMemoryHistory({ initialEntries: [path] }).location;

describe('isSameLocation', () => {
  test('same doc path', () => {
    expect(isSameLocation(at('/doc1'), '/doc1')).toBe(true);
  });

  test('different doc', () => {
    expect(isSameLocation(at('/doc1'), '/doc2')).toBe(false);
  });

  test('search must match', () => {
    expect(isSameLocation(at('/doc1?mode=page'), '/doc1?mode=page')).toBe(
      true
    );
    expect(isSameLocation(at('/doc1?mode=page'), '/doc1')).toBe(false);
    expect(isSameLocation(at('/doc1'), '/doc1?blockIds=b1')).toBe(false);
  });

  test('hash must match', () => {
    expect(isSameLocation(at('/doc1#b1'), '/doc1#b1')).toBe(true);
    expect(isSameLocation(at('/doc1#b1'), '/doc1')).toBe(false);
  });

  test('object To keeps the current pathname when omitted', () => {
    expect(isSameLocation(at('/doc1'), { search: '' })).toBe(true);
    expect(isSameLocation(at('/doc1'), { search: '?a=1' })).toBe(false);
    expect(isSameLocation(at('/doc1'), { pathname: '/doc1' })).toBe(true);
  });
});
