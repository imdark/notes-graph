import { BlockModel } from '@blocksuite/store';

import { defineEmbedModel } from '../../../utils/index.js';

/**
 * A named reference to another block, usable inside a synced-formula
 * expression like a spreadsheet cell. `name` is the identifier the formula
 * refers to (e.g. `[Deadline]` or `qty`); `pageId`/`blockId` address the
 * target block (same shape as the primary source).
 */
export type SyncedBlockRef = {
  name: string;
  pageId: string;
  blockId: string;
};

/**
 * A live reference to a single block in (possibly) another doc — the
 * Notion "synced block": the embed renders the referenced block's actual
 * text, editable from either side, because both sites bind the same
 * underlying Y.Text. No copy, no sync loop.
 */
export type EmbedSyncedBlockProps = {
  /** doc the referenced block lives in */
  pageId: string;
  /** the referenced block */
  blockId: string;
  caption?: string | null;
  /**
   * When set, this is a synced *formula*: instead of mirroring the source
   * block's text editably, the embed renders the expression's computed
   * result, with `value` bound to the source block's current value
   * (numeric text becomes a number). `value + 15` keeps this block equal
   * to the source plus fifteen, live. Null/empty = plain synced block.
   */
  expression?: string | null;
  /**
   * Extra named block references the formula can read besides `value`, so
   * an expression can combine several blocks (spreadsheet-style):
   * `value + [qty] * [price]`. Each entry maps a name to a target block.
   */
  refs?: SyncedBlockRef[];
};

export class EmbedSyncedBlockModel extends defineEmbedModel<EmbedSyncedBlockProps>(
  BlockModel
) {}
