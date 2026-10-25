import { type Store, Text } from '@blocksuite/notesgraph/store';

/**
 * Make the first note of `store` read `text`, one paragraph per line, editing
 * lines in place so a capture rewritten on every keystroke only touches what
 * changed. Blank lines are dropped.
 */
export function writeCapture(store: Store, text: string) {
  const [note] = store.getModelsByFlavour('notesgraph:note');
  if (!note) return;
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  // Read once: children only catch up once the transaction is over.
  const blocks = [...note.children];

  store.transact(() => {
    blocks.slice(0, lines.length).forEach((block, index) => {
      const line = lines[index];
      if (block.text && block.text.toString() !== line) {
        block.text.replace(0, block.text.length, line);
      }
    });
    const added = lines.slice(blocks.length);
    if (added.length > 0) {
      store.addBlocks(
        added.map(line => ({
          flavour: 'notesgraph:paragraph',
          blockProps: { text: new Text(line) },
        })),
        note
      );
    }
    for (const block of blocks.slice(lines.length)) {
      store.deleteBlock(block);
    }
  });
}
