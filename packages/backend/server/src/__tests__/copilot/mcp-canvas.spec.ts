import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import test from 'ava';
import * as Y from 'yjs';

import type { DocReader } from '../../core/doc';
import { createDocWithMarkdown } from '../../native';
import {
  buildScene,
  inkRegions,
  readCanvasElements,
  renderCanvas,
} from '../../plugins/copilot/mcp/canvas';
import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

const NATIVE = '$blocksuite:internal:native$';

function block(
  blocks: Y.Map<Y.Map<unknown>>,
  id: string,
  flavour: string,
  props: Record<string, unknown>,
  children: string[] = []
) {
  const map = new Y.Map<unknown>();
  blocks.set(id, map);
  map.set('sys:id', id);
  map.set('sys:flavour', flavour);
  const kids = new Y.Array<string>();
  kids.push(children);
  map.set('sys:children', kids);
  for (const [key, value] of Object.entries(props)) {
    map.set(`prop:${key}`, value);
  }
}

function element(
  surface: Y.Map<Y.Map<unknown>>,
  props: Record<string, unknown>
) {
  const map = new Y.Map<unknown>();
  surface.set(props.id as string, map);
  for (const [key, value] of Object.entries(props)) map.set(key, value);
}

/** A whiteboard: a frame with handwriting, a LaTeX block, a note → shape. */
function canvasDoc(): Uint8Array {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  doc.transact(() => {
    block(blocks, 'page', 'notesgraph:page', {}, ['surface', 'note', 'frame']);
    const value = new Y.Map<Y.Map<unknown>>();
    const boxed = new Y.Map<unknown>();
    boxed.set('type', NATIVE);
    boxed.set('value', value);
    block(blocks, 'surface', 'notesgraph:surface', { elements: boxed });
    block(blocks, 'frame', 'notesgraph:frame', {
      xywh: '[0,0,400,300]',
      title: new Y.Text('Homework'),
      childElementIds: {},
    });
    block(
      blocks,
      'note',
      'notesgraph:note',
      { xywh: '[600,0,200,100]', displayMode: 'both' },
      ['para']
    );
    block(blocks, 'para', 'notesgraph:paragraph', {
      type: 'text',
      text: new Y.Text('Solve for x'),
    });
    block(blocks, 'eq', 'notesgraph:latex', {
      xywh: '[50,200,100,40]',
      latex: 'x^2 = 4',
    });
    // Two strokes close together (one word), one far away.
    element(value, {
      id: 's1',
      type: 'brush',
      xywh: '[40,40,40,40]',
      points: [
        [2, 2],
        [38, 38],
      ],
      lineWidth: 4,
      rotate: 0,
    });
    element(value, {
      id: 's2',
      type: 'brush',
      xywh: '[90,40,40,40]',
      points: [
        [2, 38],
        [38, 2],
      ],
      lineWidth: 4,
      rotate: 0,
    });
    element(value, {
      id: 's3',
      type: 'brush',
      xywh: '[1000,500,20,20]',
      points: [
        [0, 0],
        [20, 20],
      ],
      lineWidth: 4,
      rotate: 0,
    });
    element(value, {
      id: 'box',
      type: 'shape',
      shapeType: 'ellipse',
      xywh: '[600,300,100,60]',
      text: new Y.Text('Answer'),
      rotate: 0,
    });
    element(value, {
      id: 'arrow',
      type: 'connector',
      source: { id: 'note', position: [0.5, 1] },
      target: { id: 'box' },
    });
    element(value, {
      id: 'g',
      type: 'group',
      title: new Y.Text('Work'),
      children: { s1: true, s2: true },
    });
  });
  return Y.encodeStateAsUpdate(doc);
}

/** Pixels of an 8-bit RGB PNG made by renderCanvas, as r+g+b sums. */
function decode(png: Buffer) {
  if (png.subarray(1, 4).toString() !== 'PNG') throw new Error('not a PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat: Buffer[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString();
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const row = width * 3 + 1;
  return {
    width,
    height,
    at: (x: number, y: number) => {
      const p = y * row + 1 + x * 3;
      return raw[p] + raw[p + 1] + raw[p + 2];
    },
  };
}

test('canvas elements: ink in canvas coordinates, blocks with text', t => {
  const elements = readCanvasElements(canvasDoc());
  t.deepEqual(elements.find(e => e.id === 's1')?.strokes, [
    [
      [42, 42],
      [78, 78],
    ],
  ]);
  t.is(elements.find(e => e.id === 'eq')?.latex, 'x^2 = 4');
  t.is(elements.find(e => e.id === 'note')?.text, 'Solve for x');
  t.is(elements.find(e => e.id === 'frame')?.text, 'Homework');
  t.is(elements.find(e => e.id === 'box')?.text, 'Answer');
  const arrow = elements.find(e => e.id === 'arrow');
  t.is(arrow?.from, 'note');
  t.is(arrow?.to, 'box');
  // From the note's bottom middle to the ellipse's centre.
  t.deepEqual(arrow?.ends, [
    [700, 100],
    [650, 330],
  ]);
  // The group had no xywh: it takes its members' bounds.
  t.deepEqual(elements.find(e => e.id === 'g')?.bounds, [40, 40, 90, 40]);
});

test('ink regions group nearby strokes and read top-to-bottom', t => {
  const regions = inkRegions(readCanvasElements(canvasDoc()));
  t.deepEqual(
    regions.map(r => [r.id, r.strokeIds]),
    [
      ['ink-1', ['s1', 's2']],
      ['ink-2', ['s3']],
    ]
  );
  t.deepEqual(regions[0].bounds, [40, 40, 90, 40]);
});

test('scene: frames, groups and nearest elements of each ink region', t => {
  const scene = buildScene(readCanvasElements(canvasDoc()));
  const word = scene.inkRegions[0];
  t.is(word.frame, 'frame');
  t.is(word.group, 'g');
  t.deepEqual(word.near[0], {
    id: 'eq',
    kind: 'latex',
    label: 'x^2 = 4',
    direction: 'below',
    gap: 120,
  });
  t.is(scene.inkRegions[1].frame, undefined);
  t.is(scene.elements.find(e => e.id === 'eq')?.frame, 'frame');
  t.falsy(
    scene.elements.find(e => e.id === 's1'),
    'ink is listed by region'
  );
  t.false(scene.elements.some(e => 'strokes' in e || 'ends' in e));
  t.deepEqual(scene.readingOrder, ['ink-1', 'note', 'eq', 'box', 'ink-2']);
});

test('the drawing shows ink dark on a white background', t => {
  const elements = readCanvasElements(canvasDoc());
  const image = renderCanvas(elements);
  if (!image) throw new Error('no image');
  const png = decode(image.png);
  t.is(png.width, image.width);
  t.true(Math.max(image.width, image.height) <= 1568);
  const px = (x: number, y: number) =>
    png.at(
      Math.round((x - image.region[0]) * image.scale),
      Math.round((y - image.region[1]) * image.scale)
    );
  t.true(px(60, 60) < 150, 'on the first stroke');
  t.is(px(300, 500), 765, 'empty canvas is white');

  // Zoomed into the word: more pixels per canvas unit, capped at 4×.
  const zoom = renderCanvas(elements, [40, 40, 90, 40]);
  if (!zoom) throw new Error('no zoomed image');
  t.is(zoom.scale, 4);
  const zoomed = decode(zoom.png);
  t.true(zoomed.at((60 - zoom.region[0]) * 4, (60 - zoom.region[1]) * 4) < 150);
});

test('a real canvas: shapes, text, connectors and groups', t => {
  const bin = readFileSync(
    new URL('../__fixtures__/test-doc.snapshot.bin', import.meta.url)
  );
  const elements = readCanvasElements(bin);
  const scene = buildScene(elements);
  const connector = scene.elements.find(e => e.id === 'tCpJR12_hu');
  t.is(connector?.from, 'istDk5DOMO');
  t.is(connector?.to, 'uzfdAcEDxu');
  const title = scene.elements.find(e => e.id === 'saGXC7nPOk');
  t.is(title?.text, 'What is AFFiNE');
  t.is(title?.group, 'Gwb4ZjdyMJ');
  t.true(scene.elements.some(e => e.kind === 'note' && e.text));
  t.truthy(renderCanvas(elements));
});

test('MCP read_canvas returns the scene and a picture', async t => {
  const docs = new Map<string, Uint8Array>([
    ['board', canvasDoc()],
    ['page', createDocWithMarkdown('Plain', 'just text', 'page')],
    ['blank', Y.encodeStateAsUpdate(new Y.Doc())],
  ]);
  const reader = {
    getDoc: async (_ws: string, docId: string) => {
      const bin = docs.get(docId);
      return bin ? { spaceId: 'ws', docId, bin, timestamp: Date.now() } : null;
    },
  } as unknown as DocReader;
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: (docId: string) => ({ can: async () => docs.has(docId) }),
      }),
    }),
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const server = await provider.for('u', 'ws');
  const tool = server.tools.find(item => item.name === 'read_canvas');
  if (!tool) throw new Error('no read_canvas tool');
  const signal = new AbortController().signal;
  type Content = {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  };
  const call = async (args: Record<string, unknown>) =>
    (await tool.execute(args, { signal })) as {
      isError?: boolean;
      content: Content[];
    };

  const full = await call({ docId: 'board' });
  t.falsy(full.isError);
  t.deepEqual(
    full.content.map(c => c.type),
    ['text', 'image']
  );
  t.is(full.content[1].mimeType, 'image/png');
  const scene = JSON.parse(full.content[0].text!);
  t.deepEqual(
    scene.inkRegions.map((r: { id: string }) => r.id),
    ['ink-1', 'ink-2']
  );
  t.truthy(scene.image.scale);

  const focused = await call({ docId: 'board', focus: 'ink-2' });
  t.is(JSON.parse(focused.content[0].text!).image.scale, 4);

  const noImage = await call({ docId: 'board', image: false });
  t.deepEqual(
    noImage.content.map(c => c.type),
    ['text']
  );

  t.true((await call({ docId: 'board', focus: 'nope' })).isError);
  t.true((await call({ docId: 'missing' })).isError);
  // A page's note is on the canvas too; a doc with no canvas blocks is empty.
  const page = JSON.parse((await call({ docId: 'page' })).content[0].text!);
  t.deepEqual(
    page.elements.map((e: { kind: string }) => e.kind),
    ['note']
  );
  t.true(JSON.parse((await call({ docId: 'blank' })).content[0].text!).empty);
});
