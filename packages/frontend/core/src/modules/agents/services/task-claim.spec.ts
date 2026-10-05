import type { Store } from '@blocksuite/notesgraph/store';
import { describe, expect, test } from 'vitest';

import {
  isOpenTask,
  markTasksQueued,
  releaseQueuedTasks,
  targetTaskIds,
  unfinishedTaskIds,
} from './task-claim';

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
      chip: {
        ops: [
          { insert: ' ', attributes: { orgStatus: '[ ]' } },
          { insert: ' a' },
        ],
      },
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
      going: {
        ops: [
          { insert: ' ', attributes: { orgStatus: '[-]' } },
          { insert: ' a' },
        ],
      },
      done: { ops: [{ insert: 'b' }], props: { type: 'todo', checked: true } },
      prose: { ops: [{ insert: 'just a line' }] },
    });

    expect(markTasksQueued(store, ['going', 'done', 'prose', 'gone'])).toEqual(
      []
    );
    expect(status('going')).toBe('[-]');
  });
});

describe('isOpenTask', () => {
  test('is a to-do no agent has taken yet', () => {
    const { store } = storeOf({
      box: { ops: [{ insert: 'a' }], props: { type: 'todo', checked: false } },
      typed: { ops: [{ insert: 'TODO b' }] },
      queued: {
        ops: [
          { insert: ' ', attributes: { orgStatus: 'QUEUED' } },
          { insert: ' c' },
        ],
      },
      going: {
        ops: [
          { insert: ' ', attributes: { orgStatus: '[-]' } },
          { insert: ' d' },
        ],
      },
      done: { ops: [{ insert: 'e' }], props: { type: 'todo', checked: true } },
      prose: { ops: [{ insert: 'just a line' }] },
    });
    const open = (id: string) => isOpenTask(store.getBlock(id)!.model);

    expect(
      ['box', 'typed', 'queued', 'going', 'done', 'prose'].map(open)
    ).toEqual([true, true, false, false, false, false]);
  });
});

/** A tree of blocks, each a task with a status or plain prose. */
const treeOf = (
  root: string,
  blocks: Record<string, { status?: string; children?: string[] }>
) => {
  const models = new Map<string, unknown>();
  const model = (id: string): any => {
    if (!models.has(id)) {
      const { status, children = [] } = blocks[id];
      models.set(id, {
        id,
        props: {},
        text: new FakeText(
          status
            ? [
                { insert: ' ', attributes: { orgStatus: status } },
                { insert: ` ${id}` },
              ]
            : [{ insert: id }]
        ),
        get children() {
          return children.map(model);
        },
      });
    }
    return models.get(id);
  };
  return {
    root: model(root),
    getBlock: (id: string) => (blocks[id] ? { model: model(id) } : null),
  } as unknown as Store;
};

describe('targetTaskIds and unfinishedTaskIds', () => {
  const store = treeOf('page', {
    page: { children: ['heading', 'list'] },
    heading: { children: [] },
    list: { status: '[-]', children: ['a', 'b', 'c', 'd'] },
    a: { status: '[ ]' },
    b: { status: '[X]' },
    c: { status: 'QUEUED', children: ['e'] },
    d: { status: 'BLOCKED' },
    e: { status: 'TODO' },
  });

  test('a run on a parent is on it and every task under it', () => {
    const target = { kind: 'block', docId: 'doc', blockId: 'list' } as const;
    expect(targetTaskIds(store, target)).toEqual([
      'list',
      'a',
      'b',
      'c',
      'e',
      'd',
    ]);
    expect(unfinishedTaskIds(store, target)).toEqual(['list', 'a', 'c', 'e']);
  });

  test('a whole note is on all its tasks; a selection on each once', () => {
    expect(targetTaskIds(store, { kind: 'doc', docId: 'doc' })).toHaveLength(6);
    expect(
      targetTaskIds(store, {
        kind: 'selection',
        docId: 'doc',
        blockIds: ['c', 'e', 'heading', 'gone'],
      })
    ).toEqual(['c', 'e']);
  });
});

describe('releaseQueuedTasks', () => {
  test('hands back a task still queued, not one the agent moved on', () => {
    const { store, status } = storeOf({
      waiting: {
        ops: [
          { insert: ' ', attributes: { orgStatus: 'QUEUED' } },
          { insert: ' a' },
        ],
      },
      taken: {
        ops: [
          { insert: ' ', attributes: { orgStatus: '[X]' } },
          { insert: ' b' },
        ],
      },
    });

    releaseQueuedTasks(store, ['waiting', 'taken']);

    expect(status('waiting')).toBe('[ ]');
    expect(status('taken')).toBe('[X]');
  });
});
