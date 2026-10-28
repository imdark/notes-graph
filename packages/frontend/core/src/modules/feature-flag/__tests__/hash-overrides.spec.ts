import { expect, test } from 'vitest';

import { parseFlagHashOverrides } from '../hash-overrides';

const known = ['a', 'b', 'c'];

test('turns flags on and off', () => {
  expect(parseFlagHashOverrides('#ng-flags=a,-b', known)).toEqual({
    a: true,
    b: false,
  });
});

test('ignores unknown flags, blanks and other hash params', () => {
  expect(parseFlagHashOverrides('#x=1&ng-flags=zzz,, c', known)).toEqual({
    c: true,
  });
  expect(parseFlagHashOverrides('#section', known)).toEqual({});
  expect(parseFlagHashOverrides('', known)).toEqual({});
});
