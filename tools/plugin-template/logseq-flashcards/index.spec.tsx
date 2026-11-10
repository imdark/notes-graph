/**
 * @vitest-environment happy-dom
 */
import { parseManifest } from '@notesgraph/plugin-sdk';
import type { PluginBlock } from '@notesgraph/plugin-sdk/client';
import {
  createPluginHarness,
  type PluginHarness,
} from '@notesgraph/plugin-sdk/testing';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import plugin, { extractCards, fileNameFor, toLogseq } from './index.js';
import manifestJson from './manifest.json';

const manifest = manifestJson as Parameters<
  typeof createPluginHarness
>[0]['manifest'];

// --- A tiny note builder: nested arrays become a page > note > blocks tree ---

type Spec = {
  flavour?: string;
  text?: string;
  type?: string;
  props?: Record<string, unknown>;
  children?: Spec[];
};

const p = (text: string, children: Spec[] = []): Spec => ({
  flavour: 'notesgraph:paragraph',
  type: 'text',
  text,
  children,
});
const heading = (level: number, text: string): Spec => ({
  flavour: 'notesgraph:paragraph',
  type: `h${level}`,
  text,
});
const li = (text: string, children: Spec[] = [], type = 'bulleted'): Spec => ({
  flavour: 'notesgraph:list',
  type,
  text,
  children,
});

function note(...content: Spec[]): PluginBlock[] {
  const blocks: PluginBlock[] = [];
  let n = 0;
  const add = (spec: Spec): string => {
    const id = `b${n++}`;
    const block: PluginBlock = {
      id,
      flavour: spec.flavour ?? 'notesgraph:paragraph',
      props: {
        ...(spec.type ? { type: spec.type } : {}),
        ...(spec.text !== undefined ? { text: spec.text } : {}),
        ...spec.props,
      },
      children: [],
    };
    blocks.push(block);
    block.children = (spec.children ?? []).map(add);
    return id;
  };
  const noteId = add({ flavour: 'notesgraph:note', children: content });
  // The page goes last so the builder also proves order comes from the tree.
  blocks.push({
    id: 'page',
    flavour: 'notesgraph:page',
    props: { title: 'Biology' },
    children: [noteId],
  });
  return blocks;
}

const md = (...content: Spec[]) => toLogseq(extractCards(note(...content)));

describe('which blocks become cards', () => {
  test('a list item with its answer nested under it', () => {
    expect(md(li('What does the mitochondria do?', [li('Makes ATP')]))).toBe(
      '- What does the mitochondria do? #card\n\t- Makes ATP\n'
    );
  });

  test('a heading with the paragraphs after it, up to the next heading', () => {
    expect(
      md(
        heading(2, 'Osmosis'),
        p('Water moving across a membrane.'),
        p('From low to high solute.'),
        heading(2, 'Diffusion'),
        p('Particles spreading out.')
      )
    ).toBe(
      [
        '- Osmosis #card',
        '\t- Water moving across a membrane.',
        '\t- From low to high solute.',
        '- Diffusion #card',
        '\t- Particles spreading out.',
        '',
      ].join('\n')
    );
  });

  test('a topic holding cards gives its cards, not itself', () => {
    expect(
      md(
        heading(1, 'Cells'),
        li('Nucleus', [li('Holds the DNA')]),
        li('Ribosome', [li('Builds proteins')])
      )
    ).toBe(
      [
        '- Nucleus #card',
        '\t- Holds the DNA',
        '- Ribosome #card',
        '\t- Builds proteins',
        '',
      ].join('\n')
    );
  });

  test('a question keeps its whole subtree, even nested cards', () => {
    expect(
      md(
        li('What are the phases of mitosis?', [
          li('Prophase', [li('Chromosomes condense')]),
          li('Metaphase', [li('They line up')]),
        ])
      )
    ).toBe(
      [
        '- What are the phases of mitosis? #card',
        '\t- Prophase',
        '\t\t- Chromosomes condense',
        '\t- Metaphase',
        '\t\t- They line up',
        '',
      ].join('\n')
    );
  });

  test('an existing #card tag is kept once, at the end', () => {
    expect(md(li('#card Krebs cycle', [li('In the matrix')]))).toBe(
      '- Krebs cycle #card\n\t- In the matrix\n'
    );
  });

  test('blocks with nothing under them are not cards', () => {
    expect(
      extractCards(note(p('Just a thought.'), li('A lone bullet')))
    ).toEqual([]);
    expect(extractCards(note(heading(2, 'Empty section')))).toEqual([]);
    expect(md()).toBe('');
  });

  test('a question with no answer is skipped', () => {
    expect(extractCards(note(li('Why?')))).toEqual([]);
  });
});

describe('how answers are written', () => {
  test('todos, quotes, code and links keep their meaning', () => {
    expect(
      md(
        li('What is left?', [
          li('Read chapter 3', [], 'todo'),
          {
            ...li('Read chapter 2', [], 'todo'),
            props: { checked: true },
          },
          { ...p('Cells are the unit of life'), type: 'quote' },
          {
            flavour: 'notesgraph:code',
            text: 'print(1)\nprint(2)\n',
            props: { language: 'python' },
          },
          {
            flavour: 'notesgraph:bookmark',
            props: { url: 'https://example.com/cells' },
          },
        ])
      )
    ).toBe(
      [
        '- What is left? #card',
        '\t- TODO Read chapter 3',
        '\t- DONE Read chapter 2',
        '\t- > Cells are the unit of life',
        '\t- ```python',
        '\t  print(1)',
        '\t  print(2)',
        '\t  ```',
        '\t- https://example.com/cells',
        '',
      ].join('\n')
    );
  });

  test('a block with nothing to show passes its children up', () => {
    expect(
      md(
        li('What is in the diagram?', [
          {
            flavour: 'notesgraph:image',
            children: [p('A cell wall')],
          },
        ])
      )
    ).toBe('- What is in the diagram? #card\n\t- A cell wall\n');
  });

  test('a multi-line question is folded onto one line', () => {
    expect(md(li('What is\nosmosis?', [li('Water moving')]))).toBe(
      '- What is osmosis? #card\n\t- Water moving\n'
    );
  });
});

test('file names are safe for a Logseq pages folder', () => {
  expect(fileNameFor('Bio: cells / week 2?')).toBe('Bio_ cells _ week 2_.md');
  expect(fileNameFor('')).toBe('Untitled.md');
});

// --- The plugin in the harness ----------------------------------------------

const DOC = { id: 'doc-1', title: 'Biology', mode: 'page' as const };

const harnessWith = async (
  blocks: PluginBlock[],
  docs = [DOC]
): Promise<PluginHarness> => {
  const harness = createPluginHarness({
    manifest,
    docs,
    blocks: { 'doc-1': blocks },
  });
  await harness.activate(plugin);
  return harness;
};

const cellNote = () =>
  note(
    li('What does the nucleus hold?', [li('DNA')]),
    li('What builds proteins?', [li('Ribosomes')])
  );

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

describe('plugin contributions', () => {
  test('two commands and a sidebar panel, all gone on deactivate', async () => {
    const harness = await harnessWith(cellNote());
    expect(harness.commands.map(c => c.id)).toEqual([
      'logseq-flashcards:copy',
      'logseq-flashcards:download',
    ]);
    expect(harness.sidebarPanels.map(p => p.id)).toEqual(['logseq-flashcards']);

    await harness.deactivate();
    expect(harness.commands).toHaveLength(0);
    expect(harness.sidebarPanels).toHaveLength(0);
  });

  test('has a manifest the plugin server will seed', () => {
    // seedBundledPlugins skips a folder whose manifest fails the schema.
    expect(() => parseManifest(manifestJson)).not.toThrow();
  });

  test('declares the capabilities it uses', async () => {
    const harness = createPluginHarness({ manifest, permissions: [] });
    await expect(harness.activate(plugin)).rejects.toThrow(
      /missing permission: ui/
    );
  });
});

describe('copy command', () => {
  test("copies the open note's cards and says how many", async () => {
    const harness = await harnessWith(cellNote());
    await harness.runCommand('logseq-flashcards:copy');

    expect(writeText).toHaveBeenCalledWith(
      [
        '- What does the nucleus hold? #card',
        '\t- DNA',
        '- What builds proteins? #card',
        '\t- Ribosomes',
        '',
      ].join('\n')
    );
    expect(harness.notifications).toEqual([
      expect.objectContaining({ title: 'Copied 2 cards', theme: 'success' }),
    ]);
  });

  test('says how to write cards when the note has none', async () => {
    const harness = await harnessWith(note(p('Nothing to study here.')));
    await harness.runCommand('logseq-flashcards:copy');

    expect(writeText).not.toHaveBeenCalled();
    expect(harness.notifications[0]).toMatchObject({
      title: 'No flashcards in "Biology"',
      theme: 'warning',
    });
  });

  test('asks for a note when none is open', async () => {
    const harness = await harnessWith([], []);
    await harness.runCommand('logseq-flashcards:copy');
    expect(harness.notifications[0].title).toBe('Open a note first');
  });

  test('reports a refused clipboard as an error', async () => {
    writeText.mockRejectedValueOnce(new Error('Document is not focused'));
    const harness = await harnessWith(cellNote());
    await harness.runCommand('logseq-flashcards:copy');
    expect(harness.notifications[0]).toMatchObject({
      title: 'Could not export flashcards',
      message: 'Document is not focused',
      theme: 'error',
    });
  });
});

describe('download command', () => {
  test('saves a .md page named after the note', async () => {
    const createObjectURL = vi.fn(() => 'blob:cards');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });

    const harness = await harnessWith(cellNote());
    await harness.runCommand('logseq-flashcards:download');

    expect(clicked).toEqual(['Biology.md']);
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
    expect(await blob.text()).toContain('- What builds proteins? #card');
    expect(harness.notifications[0].title).toBe('Saved Biology.md');
    click.mockRestore();
  });
});

describe('sidebar panel', () => {
  const renderPanel = (harness: PluginHarness) => {
    const Panel = harness.sidebarPanels[0].component;
    return render(<Panel />);
  };

  test('previews the markdown and copies it', async () => {
    const harness = await harnessWith(cellNote());
    renderPanel(harness);

    await waitFor(() =>
      expect(screen.getByText('2 cards from "Biology"')).toBeTruthy()
    );
    expect(screen.getByLabelText('Logseq markdown').textContent).toContain(
      '- What does the nucleus hold? #card'
    );

    fireEvent.click(screen.getByText('Copy for Logseq'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  test('explains what makes a card when there are none', async () => {
    const harness = await harnessWith(note(p('Loose thoughts.')));
    renderPanel(harness);
    await waitFor(() =>
      expect(screen.getByText('No flashcards in "Biology"')).toBeTruthy()
    );
    expect(screen.getByText(/ending in "\?"/)).toBeTruthy();
  });

  test('asks for a note when none is open', async () => {
    const harness = await harnessWith([], []);
    renderPanel(harness);
    await waitFor(() =>
      expect(screen.getByText(/Open a note to make/)).toBeTruthy()
    );
  });

  test('reloads when a note opens', async () => {
    // The harness reads `blocks` per call, so swapping the entry stands in
    // for the user opening a different note.
    const blocks = { 'doc-1': note(p('Loose thoughts.')) };
    const harness = createPluginHarness({ manifest, docs: [DOC], blocks });
    await harness.activate(plugin);
    renderPanel(harness);
    await waitFor(() => expect(screen.getByText(/No flashcards/)).toBeTruthy());

    blocks['doc-1'] = cellNote();
    harness.emit('doc.open', { docId: 'doc-1' });

    await waitFor(() =>
      expect(screen.getByText('2 cards from "Biology"')).toBeTruthy()
    );
  });

  test('shows a read failure with a way to retry', async () => {
    const harness = await harnessWith(cellNote());
    vi.spyOn(harness.context.docs, 'getBlocks').mockRejectedValueOnce(
      new Error('doc not loaded')
    );
    renderPanel(harness);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Could not read the note: doc not loaded'
      )
    );
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() =>
      expect(screen.getByText('2 cards from "Biology"')).toBeTruthy()
    );
  });
});
