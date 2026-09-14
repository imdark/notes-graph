import { describe, expect, test } from 'vitest';

import { combineTitleBodyScore, type DocSignals } from './doc-embedder';

const unit = (x: number, y: number): number[] => {
  const norm = Math.sqrt(x * x + y * y) || 1;
  return [x / norm, y / norm];
};

const signals = (
  title: number[] | null,
  body: number[] | null
): DocSignals => ({ title, body });

describe('combineTitleBodyScore', () => {
  test('identical titles with different bodies do NOT score ~100%', () => {
    // titles identical (cosine 1), bodies orthogonal (cosine 0)
    const score = combineTitleBodyScore(
      signals(unit(1, 0), unit(1, 0)),
      signals(unit(1, 0), unit(0, 1))
    );
    expect(score).toBeCloseTo(0.3, 5);
  });

  test('identical bodies dominate the score', () => {
    const score = combineTitleBodyScore(
      signals(unit(1, 0), unit(1, 0)),
      signals(unit(0, 1), unit(1, 0))
    );
    expect(score).toBeCloseTo(0.7, 5);
  });

  test('identical titles and bodies score 1', () => {
    const score = combineTitleBodyScore(
      signals(unit(1, 0), unit(0.5, 0.5)),
      signals(unit(1, 0), unit(0.5, 0.5))
    );
    expect(score).toBeCloseTo(1, 5);
  });

  test('both bodies empty: the title decides alone (empty stubs merge)', () => {
    const score = combineTitleBodyScore(
      signals(unit(1, 0), null),
      signals(unit(1, 0), null)
    );
    expect(score).toBeCloseTo(1, 5);
  });

  test('one body empty: that side scores 0, not "same"', () => {
    const score = combineTitleBodyScore(
      signals(unit(1, 0), unit(1, 0)),
      signals(unit(1, 0), null)
    );
    expect(score).toBeCloseTo(0.3, 5);
  });

  test('both untitled: the body decides alone', () => {
    const score = combineTitleBodyScore(
      signals(null, unit(1, 0)),
      signals(null, unit(1, 0))
    );
    expect(score).toBeCloseTo(1, 5);
  });

  test('no signal at all returns null', () => {
    expect(combineTitleBodyScore(signals(null, null), signals(null, null))).toBe(
      null
    );
  });
});
