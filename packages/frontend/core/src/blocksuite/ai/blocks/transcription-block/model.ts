import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/notesgraph/store';
import type {
  TranscriptionQualityInput,
  TranscriptionSourceAudioInput,
} from '@notesgraph/graphql';

export const TranscriptionBlockFlavour = 'notesgraph:transcription';

const defaultProps: TranscriptionBlockProps = {
  transcription: {},
  jobId: undefined,
  createdBy: undefined, // the user id of the creator
};

export const TranscriptionBlockSchema = defineBlockSchema({
  flavour: TranscriptionBlockFlavour,
  props: () => defaultProps,
  metadata: {
    version: 1,
    role: 'attachment-viewer',
    parent: ['notesgraph:attachment'],
    children: ['notesgraph:callout'],
  },
  toModel: () => new TranscriptionBlockModel(),
});

export type TranscriptionBlockProps = {
  transcription: {
    sourceAudio?: TranscriptionSourceAudioInput;
    quality?: TranscriptionQualityInput;
  };
  jobId?: string;
  createdBy?: string;
};

export class TranscriptionBlockModel extends BlockModel<TranscriptionBlockProps> {}

export const TranscriptionBlockSchemaExtension = BlockSchemaExtension(
  TranscriptionBlockSchema
);
