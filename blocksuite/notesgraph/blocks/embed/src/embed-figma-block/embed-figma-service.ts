import {
  EmbedFigmaBlockSchema,
  EmbedFigmaStyles,
} from '@blocksuite/notesgraph-model';
import { EmbedOptionConfig } from '@blocksuite/notesgraph-shared/services';

import { figmaUrlRegex } from './embed-figma-model.js';

export const EmbedFigmaBlockOptionConfig = EmbedOptionConfig({
  flavour: EmbedFigmaBlockSchema.model.flavour,
  urlRegex: figmaUrlRegex,
  styles: EmbedFigmaStyles,
  viewType: 'embed',
});
