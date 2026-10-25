import { describe, expect, it } from 'vitest';

import {
  type GoalTaggableText,
  hasGoalTag,
  toggleGoalTag,
} from '../../utils/goal-tag';

type Op = { insert: string; attributes?: Record<string, unknown> };

/** One character per op is enough to track where attributes land. */
class FakeText implements GoalTaggableText {
  ops: Op[];
  constructor(ops: Op[]) {
    this.ops = ops.flatMap(op =>
      [...op.insert].map(c => ({ insert: c, attributes: op.attributes }))
    );
  }
  toString() {
    return this.ops.map(op => op.insert).join('');
  }
  toDelta() {
    return this.ops;
  }
  insert(content: string, index: number, attributes?: Record<string, unknown>) {
    this.ops.splice(
      index,
      0,
      ...[...content].map(c => ({ insert: c, attributes }))
    );
  }
  delete(index: number, length: number) {
    this.ops.splice(index, length);
  }
  tagged() {
    return this.ops
      .filter(op => op.attributes?.orgTag === 'goal')
      .map(op => op.insert)
      .join('');
  }
}

describe('hasGoalTag', () => {
  it('finds #goal as a whole token only', () => {
    expect(hasGoalTag('Run a marathon #goal')).toBe(true);
    expect(hasGoalTag('#GOAL learn rust')).toBe(true);
    expect(hasGoalTag('my #goals')).toBe(false);
    expect(hasGoalTag('a#goal')).toBe(false);
    expect(hasGoalTag('#goal:2027')).toBe(false);
  });
});

describe('toggleGoalTag', () => {
  it('tags a task at the end of its words', () => {
    const text = new FakeText([{ insert: 'Run a marathon' }]);
    expect(toggleGoalTag(text)).toBe(true);
    expect(text.toString()).toBe('Run a marathon #goal');
    expect(text.tagged()).toBe('#goal');
  });

  it('goes before the STARTED badge, not after it', () => {
    const text = new FakeText([
      { insert: 'Learn Rust ' },
      { insert: ' ', attributes: { orgTimestamp: 'STARTED: [2026-10-25]' } },
    ]);
    toggleGoalTag(text);
    expect(text.toString()).toBe('Learn Rust #goal  ');
    expect(text.ops.at(-1)?.attributes?.orgTimestamp).toBeDefined();
  });

  it('tags an empty task without a leading space', () => {
    const text = new FakeText([]);
    toggleGoalTag(text);
    expect(text.toString()).toBe('#goal');
  });

  it('removes the tag and its space again', () => {
    for (const before of [
      'Run a marathon #goal',
      '#goal Run a marathon',
      'Run #goal a marathon',
    ]) {
      const text = new FakeText([{ insert: before }]);
      expect(toggleGoalTag(text)).toBe(false);
      expect(text.toString()).toBe('Run a marathon');
    }
  });

  it('round-trips', () => {
    const text = new FakeText([{ insert: 'Write a book' }]);
    toggleGoalTag(text);
    toggleGoalTag(text);
    expect(text.toString()).toBe('Write a book');
  });
});
