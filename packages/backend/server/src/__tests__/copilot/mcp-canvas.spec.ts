import test from 'ava';
import * as Y from 'yjs';

import {
  canvasSvg,
  drawOnCanvas,
  readCanvas,
} from '../../plugins/copilot/mcp/canvas';
import {
  WorkspaceMcpProvider,
  type WorkspaceMcpToolResult,
} from '../../plugins/copilot/mcp/provider';

/** A doc as the server creates one: page, surface, and a note on the canvas. */
function canvasDoc(withSurface = true): Uint8Array {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  doc.transact(() => {
    const block = (id: string, flavour: string, children: string[] = []) => {
      const map = new Y.Map<unknown>();
      blocks.set(id, map);
      map.set('sys:id', id);
      map.set('sys:flavour', flavour);
      const kids = new Y.Array<string>();
      kids.push(children);
      map.set('sys:children', kids);
      return map;
    };
    block(
      'page',
      'notesgraph:page',
      withSurface ? ['surface', 'note'] : ['note']
    );
    if (withSurface) {
      const surface = block('surface', 'notesgraph:surface');
      const boxed = new Y.Map<unknown>();
      surface.set('prop:elements', boxed);
      boxed.set('type', '$blocksuite:internal:native$');
      const value = new Y.Map<unknown>();
      boxed.set('value', value);
      const shape = new Y.Map<unknown>();
      value.set('s1', shape);
      shape.set('type', 'shape');
      shape.set('id', 's1');
      shape.set('index', 'a1');
      shape.set('shapeType', 'ellipse');
      shape.set('xywh', '[100,100,200,80]');
      shape.set('strokeColor', { light: '#000', dark: '#fff' });
      shape.set('text', new Y.Text('Idea'));
    }
    const note = block('note', 'notesgraph:note', ['p1']);
    note.set('prop:xywh', '[0,400,500,120]');
    note.set('prop:index', 'a0');
    const paragraph = block('p1', 'notesgraph:paragraph');
    paragraph.set('prop:text', new Y.Text('Hello canvas'));
  });
  return Y.encodeStateAsUpdate(doc);
}

function apply(binary: Uint8Array, update: Uint8Array | null) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  if (update) Y.applyUpdate(doc, update);
  return Y.encodeStateAsUpdate(doc);
}

const text = (result: WorkspaceMcpToolResult) =>
  result.content[0].type === 'text' ? result.content[0].text : '';

test('readCanvas lists elements and canvas blocks back to front', t => {
  const { hasSurface, items } = readCanvas(canvasDoc());
  t.true(hasSurface);
  t.deepEqual(
    items.map(item => [item.id, item.type, item.kind]),
    [
      ['note', 'note', 'block'],
      ['s1', 'shape', 'element'],
    ]
  );
  t.is(items[0].text, 'Hello canvas');
  t.is(items[1].text, 'Idea');
  t.is(items[1].color, '#000');
  t.like(items[1], { x: 100, y: 100, w: 200, h: 80, shapeType: 'ellipse' });
});

test('drawOnCanvas adds ink, shapes, text and connectors on top', t => {
  const before = canvasDoc();
  const { update, ids } = drawOnCanvas(before, [
    {
      type: 'stroke',
      points: [
        [10, 20],
        [30, 60],
      ],
      width: 4,
      color: '#d14',
    },
    { type: 'shape', key: 'box', x: 400, y: 100, w: 100, h: 50, text: 'B' },
    { type: 'text', x: 0, y: 0, text: 'Title' },
    { type: 'connector', from: 's1', to: 'box' },
  ]);
  t.is(ids.length, 4);
  const { items } = readCanvas(apply(before, update));
  t.is(items.length, 6);
  // New items go on top, in the order given.
  t.deepEqual(
    items.slice(2).map(item => item.id),
    ids
  );

  const stroke = items.find(item => item.id === ids[0])!;
  t.like(stroke, { type: 'brush', x: 8, y: 18, w: 24, h: 44, color: '#d14' });
  // Points are stored relative to the box and read back absolute.
  t.deepEqual(stroke.points, [
    [10, 20],
    [30, 60],
  ]);

  const connector = items.find(item => item.id === ids[3])!;
  t.deepEqual(connector.source, { id: 's1' });
  t.deepEqual(connector.target, { id: ids[1] });
  t.is(items.find(item => item.id === ids[2])!.text, 'Title');
});

test('drawOnCanvas refuses a doc without a canvas and unknown connector ends', t => {
  t.throws(
    () =>
      drawOnCanvas(canvasDoc(false), [{ type: 'text', x: 0, y: 0, text: 'x' }]),
    {
      message: /no canvas/,
    }
  );
  t.throws(
    () =>
      drawOnCanvas(canvasDoc(), [
        { type: 'connector', from: 'nope', to: [0, 0] },
      ]),
    { message: /not an element/ }
  );
});

test('canvasSvg draws a region and leaves out what is outside it', t => {
  const { items } = readCanvas(canvasDoc());
  const whole = canvasSvg(items);
  t.true(whole.svg.includes('<ellipse'));
  t.true(whole.svg.includes('Hello canvas'));
  const region = canvasSvg(items, { x: 0, y: 380, w: 600, h: 200 });
  t.false(region.svg.includes('<ellipse'));
  t.true(region.svg.includes('Hello canvas'));
  t.deepEqual(region.region, { x: 0, y: 380, w: 600, h: 200 });
  t.is(canvasSvg(items, { x: 0, y: 0, w: 4000, h: 2000 }, 1000).width, 1000);
});

test('MCP read_canvas, capture_canvas and draw_on_canvas', async t => {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const docs: Record<string, Uint8Array> = { d1: canvasDoc() };
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: (docId: string) => ({ can: async () => docId in docs }),
      }),
    }),
  };
  const reader = {
    getDoc: async (_ws: string, docId: string) =>
      docs[docId] ? { bin: docs[docId] } : null,
  };
  const writer = {
    editDoc: async (
      _ws: string,
      docId: string,
      edit: (binary: Uint8Array) => { update: Uint8Array | null }
    ) => {
      const result = edit(docs[docId]);
      docs[docId] = apply(docs[docId], result.update);
      return result;
    },
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader as any,
    writer as any,
    {} as any,
    {} as any,
    {} as any
  );
  const server = await provider.for('u', 'ws');
  const signal = new AbortController().signal;
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = server.tools.find(item => item.name === name);
    if (!tool) throw new Error('no tool ' + name);
    return tool.execute(args, { signal });
  };

  const drawn = await call('draw_on_canvas', {
    docId: 'd1',
    items: [{ type: 'shape', x: 600, y: 0, w: 50, h: 50, text: 'new' }],
  });
  t.falsy(drawn.isError);
  const [id] = JSON.parse(text(drawn)).ids;

  const read = await call('read_canvas', {
    docId: 'd1',
    region: { x: 590, y: -10, w: 100, h: 100 },
  });
  const listed = JSON.parse(text(read));
  t.is(listed.count, 1);
  t.is(listed.items[0].id, id);
  t.is(listed.items[0].text, 'new');

  const captured = await call('capture_canvas', { docId: 'd1' });
  t.falsy(captured.isError);
  const caption = JSON.parse(text(captured));
  t.is(caption.items, 3);
  const picture = captured.content[1];
  t.true(
    picture.type === 'image'
      ? picture.mimeType === 'image/png' && picture.data.length > 0
      : picture.text.startsWith('<svg')
  );

  const bad = await call('draw_on_canvas', {
    docId: 'd1',
    items: [{ type: 'stroke', points: [[0, 0]] }],
  });
  t.true(bad.isError);
  const missing = await call('read_canvas', { docId: 'nope' });
  t.regex(text(missing), /not found/);
});
