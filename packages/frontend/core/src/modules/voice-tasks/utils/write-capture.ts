import { type BlockModel, type Store, Text } from '@blocksuite/notesgraph/store';

const isBullet = (block: BlockModel) =>
  block.flavour === 'notesgraph:list' &&
  (block.props as { type?: string }).type === 'bulleted';

/**
 * Make the first note of `store` read `text`, one bullet per line, so each
 * captured item is its own block to click and hand to an agent. Lines are
 * edited in place, so a capture rewritten on every keystroke only touches what
 * changed. Blank lines are dropped, and blocks that aren't bullets (the empty
 * paragraph a new note starts with) are removed.
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
  const bullets = blocks.filter(isBullet);

  store.transact(() => {
    for (const block of blocks) {
      if (!isBullet(block)) store.deleteBlock(block);
    }
    bullets.slice(0, lines.length).forEach((block, index) => {
      const line = lines[index];
      if (block.text && block.text.toString() !== line) {
        block.text.replace(0, block.text.length, line);
      }
    });
    const added = lines.slice(bullets.length);
    if (added.length > 0) {
      store.addBlocks(
        added.map(line => ({
          flavour: 'notesgraph:list',
          blockProps: { type: 'bulleted', text: new Text(line) },
        })),
        note
      );
    }
    for (const block of bullets.slice(lines.length)) {
      store.deleteBlock(block);
    }
  });
}
