import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';

export const DataViewBlockSpec: ExtensionType[] = [
  FlavourExtension('notesgraph:data-view'),
  BlockViewExtension('notesgraph:data-view', literal`notesgraph-data-view`),
];
