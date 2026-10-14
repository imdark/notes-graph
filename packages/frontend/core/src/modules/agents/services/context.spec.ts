import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import { describe, expect, test } from 'vitest';

import { projectOf } from './context';

/** Blocks by id, each with its text and parent. */
const storeOf = (blocks: Record<string, { text: string; parent?: string }>) => {
  const model = (id: string) =>
    ({ id, text: { toString: () => blocks[id].text } }) as unknown as BlockModel;
  const store = {
    getParent: (child: BlockModel) => {
      const parent = blocks[child.id]?.parent;
      return parent ? model(parent) : null;
    },
  } as unknown as Store;
  return { store, model };
};

const projects = [
  { id: 'p-ai', name: 'Ai', docIds: ['ai-doc'] },
  { id: 'p-home', name: 'Home', docIds: [] },
];

describe('projectOf', () => {
  // A journal day: a heading per project, each task nested under its own.
  const { store, model } = storeOf({
    note: { text: '' },
    ai: { text: 'Ai', parent: 'note' },
    agents: { text: 'agents:', parent: 'ai' },
    task: { text: '[ ] wire the runner', parent: 'agents' },
    airflow: { text: 'Airflow', parent: 'note' },
    other: { text: '[ ] tidy', parent: 'airflow' },
    inbox: { text: 'Inbox', parent: 'note' },
    loose: { text: '[ ] call mum', parent: 'inbox' },
  });

  test('a task under a project heading belongs to it, at any depth', () => {
    expect(projectOf(store, 'journal', model('task'), projects)).toEqual(
      projects[0]
    );
  });

  test('a heading claims only by its whole name, case aside', () => {
    expect(projectOf(store, 'journal', model('other'), projects)).toBeNull();
    const lower = [{ id: 'p', name: ' ai ', docIds: [] }];
    expect(projectOf(store, 'journal', model('task'), lower)?.id).toBe('p');
  });

  test("a task under no project's heading is Inbox, unless its note is a project's", () => {
    expect(projectOf(store, 'journal', model('loose'), projects)).toBeNull();
    expect(projectOf(store, 'ai-doc', model('loose'), projects)?.id).toBe(
      'p-ai'
    );
  });

  test('the heading it sits under wins over the note it is in', () => {
    const home = [projects[0], { ...projects[1], docIds: ['journal'] }];
    expect(projectOf(store, 'journal', model('task'), home)?.id).toBe('p-ai');
  });
});
