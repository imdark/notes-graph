import { describe, expect, test } from 'vitest';

import {
  evaluateFormula,
  type FormulaValue,
} from '@blocksuite/notesgraph-shared/utils';

const env = (values: Record<string, FormulaValue>) => (name: string) => {
  const key = Object.keys(values).find(
    k => k.toLowerCase() === name.toLowerCase()
  );
  if (key === undefined) throw new Error(`unknown column '${name}'`);
  return values[key] as FormulaValue;
};

describe('formula evaluator', () => {
  test('arithmetic and precedence', () => {
    expect(evaluateFormula('1 + 2 * 3', env({}))).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', env({}))).toBe(9);
    expect(evaluateFormula('10 % 3', env({}))).toBe(1);
    expect(evaluateFormula('-2 + 5', env({}))).toBe(3);
  });

  test('column references, bare and bracketed', () => {
    const resolve = env({ Estimate: 5, 'Story Points': 8 });
    expect(evaluateFormula('estimate * 2', resolve)).toBe(10);
    expect(evaluateFormula('[Story Points] + estimate', resolve)).toBe(13);
  });

  test('string concat and comparison', () => {
    const resolve = env({ Status: 'Done' });
    expect(evaluateFormula("status == 'Done'", resolve)).toBe(true);
    expect(evaluateFormula("'is: ' + status", resolve)).toBe('is: Done');
  });

  test('ternary, logic and if()', () => {
    const resolve = env({ Points: 8 });
    expect(evaluateFormula("points > 5 ? 'big' : 'small'", resolve)).toBe(
      'big'
    );
    expect(evaluateFormula("if(points > 5, 'big', 'small')", resolve)).toBe(
      'big'
    );
    expect(evaluateFormula('points > 5 && points < 10', resolve)).toBe(true);
    expect(evaluateFormula('!empty(points)', resolve)).toBe(true);
  });

  test('date helpers', () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000 + 60 * 1000;
    expect(evaluateFormula('daysUntil([Due])', env({ Due: tomorrow }))).toBe(2);
    expect(evaluateFormula('daysUntil([Due])', env({ Due: null }))).toBe(null);
    const num = evaluateFormula('now()', env({}));
    expect(typeof num).toBe('number');
  });

  test('functions', () => {
    expect(evaluateFormula('min(3, 1, 2)', env({}))).toBe(1);
    expect(evaluateFormula('max(3, 1, 2)', env({}))).toBe(3);
    expect(evaluateFormula("len('abc')", env({}))).toBe(3);
    expect(evaluateFormula("upper('abc')", env({}))).toBe('ABC');
    expect(evaluateFormula("concat('a', 1, null, 'b')", env({}))).toBe('a1b');
    expect(evaluateFormula('round(2.5)', env({}))).toBe(3);
  });

  test('errors are values, not throws', () => {
    expect(evaluateFormula('1 +', env({}))).toMatch(/^#ERR/);
    expect(evaluateFormula('nosuch(1)', env({}))).toMatch(/^#ERR/);
    expect(evaluateFormula('missing + 1', env({}))).toMatch(/^#ERR/);
    expect(evaluateFormula('', env({}))).toBe(null);
  });
});
