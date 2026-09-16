import {
  trailHasSection,
  trailSections,
} from '@blocksuite/notesgraph/shared/services';
import { describe, expect, it } from 'vitest';

/**
 * These decide which project claims a task written in a journal, so the
 * interesting cases are the ones that must NOT match: a project should never
 * inherit a task just because the word appears somewhere nearby.
 */
describe('todo trail sections', () => {
  it('splits an indexer trail into sections', () => {
    expect(trailSections('Ai › agents:')).toEqual(['Ai', 'agents:']);
  });

  it('is empty for a task with no ancestors', () => {
    expect(trailSections(undefined)).toEqual([]);
    expect(trailSections('')).toEqual([]);
    expect(trailSections('  ›  ')).toEqual([]);
  });

  it('matches the section a task sits under, at any depth', () => {
    const trail = 'Ai › agents: › harness';
    expect(trailHasSection(trail, 'Ai')).toBe(true);
    expect(trailHasSection(trail, 'harness')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(trailHasSection('  Ai  › notes', 'ai')).toBe(true);
    expect(trailHasSection('Ai › notes', '  AI  ')).toBe(true);
  });

  it('does not match a partial section name', () => {
    // "Ai" must not claim a task under "Airflow".
    expect(trailHasSection('Airflow › tasks', 'Ai')).toBe(false);
    expect(trailHasSection('Ai › tasks', 'Airflow')).toBe(false);
  });

  it('does not match a task with no trail', () => {
    // A checkbox that is a *sibling* of the heading has no trail — which is
    // exactly why the journal scaffolding nests it under the heading instead.
    expect(trailHasSection(undefined, 'Ai')).toBe(false);
  });

  it('never matches an empty section name', () => {
    // A project with a blank name must not silently claim everything.
    expect(trailHasSection('Ai › tasks', '')).toBe(false);
    expect(trailHasSection('Ai › tasks', '   ')).toBe(false);
  });
});
