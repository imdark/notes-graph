import {
  CodeBlockModel,
  ListBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/notesgraph-model';
import {
  focusBlockEnd,
  focusBlockStart,
  getNextBlockCommand,
  getPrevBlockCommand,
} from '@blocksuite/notesgraph-shared/commands';
import { matchModels } from '@blocksuite/notesgraph-shared/utils';
import {
  type BlockComponent,
  type BlockStdScope,
  TextSelection,
} from '@blocksuite/std';
import type { BlockModel } from '@blocksuite/store';

import { selectBlock } from './select-block.js';

/**
 * Deletes a line block (paragraph or list item), landing the caret at the
 * end of the previous line or the start of the next one. The only
 * remaining line in a note is cleared instead of deleted, so the caret
 * always has somewhere to stay.
 */
export function deleteLineBlock(std: BlockStdScope, model: BlockModel): void {
  const store = std.store;

  // Work out where the caret should land before the line disappears.
  const [, prevCtx] = std.command
    .chain()
    .pipe(getPrevBlockCommand, { path: model.id })
    .run();
  const prevBlock = prevCtx.prevBlock;
  let nextBlock: BlockComponent | undefined;
  if (!prevBlock) {
    const [, nextCtx] = std.command
      .chain()
      .pipe(getNextBlockCommand, { path: model.id })
      .run();
    nextBlock = nextCtx.nextBlock;
  }

  store.captureSync();
  if (!prevBlock && !nextBlock) {
    const text = model.text;
    if (text && text.length > 0) text.delete(0, text.length);
    return;
  }

  store.deleteBlock(model);
  const focusBlock = prevBlock ?? nextBlock;
  if (!focusBlock) return;
  if (
    matchModels(focusBlock.model, [
      ParagraphBlockModel,
      ListBlockModel,
      CodeBlockModel,
    ])
  ) {
    std.command.exec(prevBlock ? focusBlockEnd : focusBlockStart, {
      focusBlock,
    });
  } else {
    std.command.exec(selectBlock, { focusBlock });
  }
}

/**
 * Cut-line entry point: with a collapsed text cursor on a paragraph or
 * list item, deletes that line and returns true. Returns false when the
 * selection isn't a collapsed cursor on a supported block, so callers can
 * fall through to the default behavior.
 */
export function deleteCurrentLine(std: BlockStdScope): boolean {
  const textSelection = std.selection.find(TextSelection);
  if (!textSelection || !textSelection.isCollapsed()) return false;

  const model = std.store.getBlock(textSelection.from.blockId)?.model;
  if (!model || !matchModels(model, [ParagraphBlockModel, ListBlockModel])) {
    return false;
  }

  deleteLineBlock(std, model);
  return true;
}
