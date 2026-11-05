import type { BlockModel, Text } from '@blocksuite/notesgraph/store';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import { nextRowProps } from './add-row';

type Op = { insert: string; attributes?: Record<string, unknown> };

const modelOf = (
  flavour: string,
  ops: Op[],
  props: Record<string, unknown> = {}
) =>
  ({
    flavour,
    props,
    text: {
      toDelta: () => ops,
      toString: () => ops.map(op => op.insert).join(''),
    },
  }) as unknown as BlockModel;

/** A new Text reads empty until it is in a doc, as it is once added. */
const textOf = (row: ReturnType<typeof nextRowProps>) => {
  const yText = (row.text as Text).yText;
  new Y.Doc().getMap('block').set('text', yText);
  return yText.toDelta();
};

describe('nextRowProps', () => {
  test('a to-do box gets a fresh unchecked box', () => {
    const row = nextRowProps(
      modelOf('notesgraph:list', [{ insert: 'buy milk' }], {
        type: 'todo',
        checked: false,
      })
    );
    expect(row.flavour).toBe('notesgraph:list');
    expect(row.type).toBe('todo');
    expect(row.checked).toBe(false);
    expect(textOf(row)).toEqual([]);
  });

  test('a status chip gets a chip of its own', () => {
    const row = nextRowProps(
      modelOf('notesgraph:paragraph', [
        { insert: ' ', attributes: { orgStatus: 'TODO' } },
        { insert: ' write it' },
      ])
    );
    expect(textOf(row)).toEqual([
      { insert: ' ', attributes: { orgStatus: 'TODO' } },
      { insert: ' ' },
    ]);
  });

  test('a typed status is typed again', () => {
    const row = nextRowProps(
      modelOf('notesgraph:paragraph', [{ insert: 'TODO write it' }], {
        type: 'text',
      })
    );
    expect(row.type).toBe('text');
    expect(textOf(row)).toEqual([{ insert: 'TODO ' }]);
  });

  test('a plain bullet gets an empty bullet', () => {
    const row = nextRowProps(
      modelOf('notesgraph:list', [{ insert: 'a note' }], { type: 'bulleted' })
    );
    expect(row.type).toBe('bulleted');
    expect(row.checked).toBeUndefined();
    expect(textOf(row)).toEqual([]);
  });
});
