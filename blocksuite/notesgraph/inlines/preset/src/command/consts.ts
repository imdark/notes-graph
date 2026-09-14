// corresponding to `formatText` command
import { TableModelFlavour } from '@blocksuite/notesgraph-model';

export const FORMAT_TEXT_SUPPORT_FLAVOURS = [
  'notesgraph:paragraph',
  'notesgraph:list',
  'notesgraph:code',
];
// corresponding to `formatBlock` command
export const FORMAT_BLOCK_SUPPORT_FLAVOURS = [
  'notesgraph:paragraph',
  'notesgraph:list',
  'notesgraph:code',
];
// corresponding to `formatNative` command
export const FORMAT_NATIVE_SUPPORT_FLAVOURS = [
  'notesgraph:database',
  TableModelFlavour,
];
