import { signal } from '@preact/signals-core';
import { describe, expect, it } from 'vitest';

import type { DataSource } from '../core/data-source/base.js';
import {
  groupRowsByNote,
  ListSingleView,
} from '../view-presets/list/list-view-manager.js';
import type { ListStoredViewData } from '../view-presets/list/types.js';

type Task = { title: string; status: string; children?: string[] };

/**
 * A list view over a task tree, filtered to hide Done like a journal's Task
 * List. `rows$` holds only the roots, the way OrgTaskRowsDataSource does.
 */
const createListView = (
  tasks: Record<string, Task>,
  roots: string[],
  options?: { tree?: boolean }
) => {
  const viewData = signal<ListStoredViewData>({
    id: 'view-1',
    name: 'Tasks',
    mode: 'list',
    filter: {
      type: 'group',
      op: 'and',
      conditions: [
        {
          type: 'filter',
          left: { type: 'ref', name: 'status' },
          function: 'isNot',
          args: [{ type: 'literal', value: 'Done' }],
        },
      ],
    },
    header: {},
  } as ListStoredViewData);
  const types = new Map([
    ['title', 'title'],
    ['status', 'text'],
  ]);

  const dataSource = {
    rows$: signal(roots),
    properties$: signal(['title', 'status']),
    readonly$: signal(false),
    featureFlags$: signal({}),
    rowChildIds:
      options?.tree === false
        ? undefined
        : (rowId: string) => tasks[rowId]?.children ?? [],
    viewDataGet: () => viewData.value,
    viewDataUpdate: () => {},
    cellValueGet: (rowId: string, propertyId: string) =>
      propertyId === 'title' ? tasks[rowId]?.title : tasks[rowId]?.status,
    propertyTypeGet: (propertyId: string) => types.get(propertyId),
    propertyNameGet: (propertyId: string) => propertyId,
    propertyDataGet: () => ({}),
    propertyReadonlyGet: () => false,
    serviceGet: () => null,
    propertyMetaGet: (type: string) => ({
      type,
      config: {
        rawValue: {
          toJson: ({ value }: { value: unknown }) => value,
          fromJson: ({ value }: { value: unknown }) => value,
          toString: ({ value }: { value: unknown }) =>
            typeof value === 'string' ? value : '',
        },
        jsonValue: {
          schema: {
            safeParse: (value: unknown) => ({ success: true, data: value }),
          },
          isEmpty: () => false,
          type: () => undefined,
        },
      },
      renderer: {},
    }),
  } as unknown as DataSource;

  const manager = { dataSource, readonly$: signal(false) };
  return new ListSingleView(manager as never, 'view-1');
};

const ids = (rows: { rowId: string }[]) => rows.map(row => row.rowId);

describe('groupRowsByNote', () => {
  const note = (id: string) => ({ id, title: id, breadcrumb: [] });

  it('roots rows under their note, notes in first-seen order', () => {
    const noteOf: Record<string, string> = { a: 'n1', b: 'n2', c: 'n1' };
    const groups = groupRowsByNote(
      [{ rowId: 'a' }, { rowId: 'b' }, { rowId: 'c' }],
      rowId => note(noteOf[rowId] ?? '')
    );

    expect(
      groups.map(g => (g.note ? [g.note.id, ids(g.rows)] : g.row))
    ).toEqual([
      ['n1', ['a', 'c']],
      ['n2', ['b']],
    ]);
  });

  it('leaves a row with no known note flat, in place', () => {
    const groups = groupRowsByNote(
      [{ rowId: 'a' }, { rowId: 'x' }, { rowId: 'b' }],
      rowId => (rowId === 'x' ? null : note('n1'))
    );

    expect(
      groups.map(g => (g.note ? [g.note.id, ids(g.rows)] : [null, g.row.rowId]))
    ).toEqual([
      ['n1', ['a', 'b']],
      [null, 'x'],
    ]);
  });
});

describe('ListSingleView tree', () => {
  it('keeps a done parent while one of its subtasks is still open', () => {
    const view = createListView(
      {
        epic: { title: 'Epic', status: 'Done', children: ['open', 'closed'] },
        open: { title: 'Open', status: 'Todo' },
        closed: { title: 'Closed', status: 'Done' },
      },
      ['epic']
    );

    expect(ids(view.rows$.value)).toEqual(['epic']);
    expect(ids(view.childRows('epic'))).toEqual(['open']);
  });

  it('keeps every ancestor of an open task, however deep', () => {
    const view = createListView(
      {
        a: { title: 'A', status: 'Done', children: ['b'] },
        b: { title: 'B', status: 'Done', children: ['c'] },
        c: { title: 'C', status: 'Todo' },
      },
      ['a']
    );

    expect(ids(view.rows$.value)).toEqual(['a']);
    expect(ids(view.childRows('a'))).toEqual(['b']);
    expect(ids(view.childRows('b'))).toEqual(['c']);
  });

  it('drops a done parent once all its subtasks are done', () => {
    const view = createListView(
      {
        epic: { title: 'Epic', status: 'Done', children: ['child'] },
        child: { title: 'Child', status: 'Done' },
        other: { title: 'Other', status: 'Todo' },
      },
      ['epic', 'other']
    );

    expect(ids(view.rows$.value)).toEqual(['other']);
  });

  it('hides done subtasks under an open parent', () => {
    const view = createListView(
      {
        epic: { title: 'Epic', status: 'Todo', children: ['done', 'todo'] },
        done: { title: 'Done one', status: 'Done' },
        todo: { title: 'Todo one', status: 'Todo' },
      },
      ['epic']
    );

    expect(ids(view.rows$.value)).toEqual(['epic']);
    expect(ids(view.childRows('epic'))).toEqual(['todo']);
  });

  it('stays flat for a source without a tree', () => {
    const view = createListView(
      {
        a: { title: 'A', status: 'Todo' },
        b: { title: 'B', status: 'Done' },
      },
      ['a', 'b'],
      { tree: false }
    );

    expect(ids(view.rows$.value)).toEqual(['a']);
    expect(view.childRows('a')).toEqual([]);
  });
});
