/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { indexRefs } from '../services/docs-search';

const a = { docId: 'a' };
const b = { docId: 'b', mode: 'edgeless' };

describe('indexRefs', () => {
  test('reads one reference, a list of them, and the list as a JSON string', () => {
    expect(indexRefs(JSON.stringify(a))).toEqual([a]);
    expect(indexRefs([JSON.stringify(a), JSON.stringify(b)])).toEqual([a, b]);
    // The phone's index hands a multi-value field back as one JSON string.
    expect(
      indexRefs(JSON.stringify([JSON.stringify(a), JSON.stringify(b)]))
    ).toEqual([a, b]);
  });

  test('drops what is empty or does not parse instead of throwing', () => {
    expect(indexRefs('')).toEqual([]);
    expect(indexRefs(undefined)).toEqual([]);
    expect(indexRefs(['', '{"docId":', JSON.stringify(a)])).toEqual([a]);
    expect(indexRefs(JSON.stringify({ nope: 1 }))).toEqual([]);
  });
});
