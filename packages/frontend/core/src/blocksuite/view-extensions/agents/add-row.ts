import type {
  BlockModel,
  BlockProps,
  Store,
} from '@blocksuite/notesgraph/store';
import { Text } from '@blocksuite/notesgraph/store';
import { readTaskStatus } from '@notesgraph/core/modules/agents/services/task-claim';

/**
 * The props of a new empty row of the same kind as `model`: same flavour and
 * type, and for a task an open status of its own, written the way this one's
 * is (a status chip, a typed `TODO`, or an unchecked to-do box).
 */
export function nextRowProps(model: BlockModel): Partial<BlockProps> {
  const props = model.props as { type?: string };
  const row: Partial<BlockProps> = { flavour: model.flavour };
  if (props.type) row.type = props.type;
  if (props.type === 'todo') row.checked = false;

  const status = readTaskStatus(model);
  if (status?.embedded) {
    const first = model.text?.toDelta()[0];
    // orgStatus is a notesgraph inline attribute the base Text type lacks.
    row.text = new Text([
      { insert: first?.insert ?? ' ', attributes: { orgStatus: status.text } },
      { insert: ' ' },
    ] as ConstructorParameters<typeof Text>[0]);
  } else if (status && status.length > 0) {
    row.text = new Text(`${status.text} `);
  } else {
    row.text = new Text();
  }
  return row;
}

/**
 * Add an empty row right after `model`, at its level (after its children,
 * not among them), and return the new block's id.
 */
export function addRowAfter(store: Store, model: BlockModel): string | null {
  const [id] = store.addSiblingBlocks(model, [nextRowProps(model)], 'after');
  return id ?? null;
}
