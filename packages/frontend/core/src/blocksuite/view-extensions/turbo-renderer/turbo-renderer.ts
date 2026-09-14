import { CodeLayoutHandlerExtension } from '@blocksuite/notesgraph/blocks/code';
import { ImageLayoutHandlerExtension } from '@blocksuite/notesgraph/blocks/image';
import { ListLayoutHandlerExtension } from '@blocksuite/notesgraph/blocks/list';
import { NoteLayoutHandlerExtension } from '@blocksuite/notesgraph/blocks/note';
import { ParagraphLayoutHandlerExtension } from '@blocksuite/notesgraph/blocks/paragraph';
import {
  TurboRendererConfigFactory,
  ViewportTurboRendererExtension,
} from '@blocksuite/notesgraph/gfx/turbo-renderer';
import { getWorkerUrl } from '@notesgraph/env/worker';

function createPainterWorker() {
  const worker = new Worker(getWorkerUrl('turbo-painter'));
  return worker;
}

export const turboRendererExtension = [
  ParagraphLayoutHandlerExtension,
  ListLayoutHandlerExtension,
  NoteLayoutHandlerExtension,
  CodeLayoutHandlerExtension,
  ImageLayoutHandlerExtension,
  TurboRendererConfigFactory({
    options: {
      zoomThreshold: 1,
      debounceTime: 1000,
    },
    painterWorkerEntry: createPainterWorker,
  }),
  ViewportTurboRendererExtension,
];
