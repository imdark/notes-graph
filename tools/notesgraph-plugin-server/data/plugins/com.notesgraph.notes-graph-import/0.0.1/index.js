// Imports a mind-link "notes graph" export into NotesGraph.
//
// Source format (graph-notes-export-*.txt / .json):
//   { "nodes": [{ "_id": "...", "name": "...", "description": "..." }, ...],
//     "links": [{ "source": "<node _id>", "target": "<node _id>" }, ...], ... }
//
// Contributes a button to NotesGraph's import dialog via ctx.ui.addImporter. Each
// node becomes a doc (title = name, body = description); each link becomes a
// linked-doc block so NotesGraph's graph view shows the same edges.

export default {
  activate(ctx) {
    ctx.ui.addImporter({
      id: 'notes-graph',
      label: 'Notes graph (JSON)',
      accept: '.json,.txt,application/json,text/plain',
      run: async files => {
        const data = JSON.parse(await files[0].text());
        const docIds = await importGraph(ctx, data);
        return { docIds };
      },
    });
  },
};

// Convert a body string into an ordered list of blocks, preserving position:
// each non-empty line becomes its own paragraph, and each URL becomes an inline
// link card (bookmark, card / 'horizontal' style) right where it appears.
function descriptionToBlocks(description) {
  const blocks = [];
  const pushText = chunk => {
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      // A line starting with "*" becomes a bulleted list item.
      const bullet = line.match(/^\*+\s*(.+)$/);
      if (bullet) {
        blocks.push({
          flavour: 'notesgraph:list',
          props: { type: 'bulleted', text: bullet[1].trim() },
        });
      } else {
        blocks.push({ flavour: 'notesgraph:paragraph', props: { text: line } });
      }
    }
  };

  const re = /https?:\/\/[^\s]+/g;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(description)) !== null) {
    pushText(description.slice(lastIndex, match.index));
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    blocks.push({
      flavour: 'notesgraph:bookmark',
      props: { url, style: 'horizontal' },
    });
    lastIndex = match.index + match[0].length;
  }
  pushText(description.slice(lastIndex));
  return blocks;
}

async function importGraph(ctx, data) {
  const nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
  const links = Array.isArray(data && data.links) ? data.links : [];

  // mind-link node _id -> created NotesGraph doc id
  const idMap = new Map();

  // Return the doc for a node id, creating one if it doesn't exist yet. Used so
  // a link can never reference a missing doc — if a node was skipped or only
  // appears in `links`, we create a stub for it rather than dropping the edge.
  const ensureDoc = async (sourceId, title) => {
    const key = String(sourceId);
    const existing = idMap.get(key);
    if (existing) return existing;
    const doc = await ctx.docs.create({ title: title || 'Untitled' });
    idMap.set(key, doc.id);
    return doc.id;
  };

  for (const node of nodes) {
    const sourceId = node._id ?? node.id;
    if (sourceId == null) continue;
    const title =
      String(node.name ?? node.title ?? 'Untitled').trim() || 'Untitled';
    const description = String(
      node.description ?? node.content ?? node.text ?? ''
    ).trim();

    let docId;
    try {
      docId = await ensureDoc(sourceId, title);
    } catch (err) {
      console.error(
        '[notes-graph-import] failed to create doc for',
        sourceId,
        err
      );
      continue;
    }

    if (description) {
      try {
        const note = (await ctx.docs.getBlocks(docId)).find(
          b => b.flavour === 'notesgraph:note'
        );
        const parent = note && note.id;
        // Insert paragraphs + link cards in their original order so cards stay
        // inline rather than collecting at the bottom.
        for (const block of descriptionToBlocks(description)) {
          await ctx.docs.insertBlock(docId, { ...block, parent });
        }
      } catch (err) {
        console.error(
          '[notes-graph-import] failed to fill doc for',
          sourceId,
          err
        );
      }
    }
  }

  for (const link of links) {
    const sourceKey = link.source ?? link.from;
    const targetKey = link.target ?? link.to;
    if (sourceKey == null || targetKey == null) continue;
    try {
      // Create a stub doc for any endpoint that has no node, so the edge always
      // resolves to a real, editable doc instead of a dangling reference.
      const from = await ensureDoc(sourceKey);
      const to = await ensureDoc(targetKey);
      const note = (await ctx.docs.getBlocks(from)).find(
        b => b.flavour === 'notesgraph:note'
      );
      await ctx.docs.insertBlock(from, {
        flavour: 'notesgraph:embed-linked-doc',
        props: { pageId: to },
        parent: note && note.id,
      });
    } catch (err) {
      console.error(
        '[notes-graph-import] failed to link',
        sourceKey,
        '->',
        targetKey,
        err
      );
    }
  }

  return [...idMap.values()];
}
