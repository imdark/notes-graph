import type { Store } from '@blocksuite/notesgraph/store';
import { describe, expect, test } from 'vitest';

import { markTasksQueued, releaseQueuedTasks } from './task-claim';

type Op = { insert: string; attributes?: { orgStatus?: string } };

/** Just enough of a block's text to read and rewrite its status chip. */
class FakeText {
  constructor(public ops: Op[]) {}
  toDelta() {
    return this.ops;
  }
  toString() {
    return this.ops.map(op => op.insert).join('');
  }
  format(_index: number, _length: number, attributes: Op['attributes']) {
    this.ops[0] = { ...this.ops[0], attributes };
  }
  replace(
    index: number,
    length: number,
    insert: string,
    attributes: Op['attributes']
  ) {
    const rest = this.toString().slice(index + length);
    this.ops = [{ insert, attributes }, { insert: rest }];
  }
  insert(insert: string, _index: number, attributes?: Op['attributes']) {
    this.ops.unshift({ insert, attributes });
  }
}

const storeOf = (
  blocks: Record<string, { ops: Op[]; props?: Record<string, unknown> }>
) => {
  const texts = new Map<string, FakeText>();
  const store = {
    getBlock: (id: string) => {
      const block = blocks[id];
      if (!block) return null;
      if (!texts.has(id)) texts.set(id, new FakeText(block.ops));
      return { model: { text: texts.get(id), props: block.props ?? {} } };
    },
  } as unknown as Store;
  const status = (id: string) => texts.get(id)?.ops[0]?.attributes?.orgStatus;
  return { store, status };
};

describe('markTasksQueued', () => {
  test('marks a to-do chip, a typed annotation and an unticked checkbox', () => {
    const { store, status } = storeOf({
      chip: { ops: [{ insert: ' ', attributes: { orgStatus: '[ ]' } }, { insert: ' a' }] },
      typed: { ops: [{ insert: 'TODO b' }] },
      box: { ops: [{ insert: 'c' }], props: { type: 'todo', checked: false } },
    });

    expect(markTasksQueued(store, ['chip', 'typed', 'box'])).toEqual([
      'chip',
      'typed',
      'box',
    ]);
    expect(['chip', 'typed', 'box'].map(status)).toEqual([
      'QUEUED',
      'QUEUED',
      'QUEUED',
    ]);
  });

  test('leaves tasks in progress or done, and non-tasks, alone', () => {
    const { store, status } = storeOf({
      going: { ops: [{ insert: ' ', attributes: { orgStatus: '[-]' } }, { insert: ' a' }] },
      done: { ops: [{ insert: 'b' }], props: { type: 'todo', checked: true } },
      prose: { ops: [{ insert: 'just a line' }] },
    });

    expect(markTasksQueued(store, ['going', 'done', 'prose', 'gone'])).toEqual(
      []
    );
    expect(status('going')).toBe('[-]');
  });
});

describe('releaseQueuedTasks', () => {
  test('hands back a task still queued, not one the agent moved on', () => {
    const { store, status } = storeOf({
      waiting: { ops: [{ insert: ' ', attributes: { orgStatus: 'QUEUED' } }, { insert: ' a' }] },
      taken: { ops: [{ insert: ' ', attributes: { orgStatus: '[X]' } }, { insert: ' b' }] },
    });

    releaseQueuedTasks(store, ['waiting', 'taken']);

    expect(status('waiting')).toBe('[ ]');
    expect(status('taken')).toBe('[X]');
  });
});
