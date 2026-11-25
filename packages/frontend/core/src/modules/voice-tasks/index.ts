import type { Framework } from '@notesgraph/infra';

import { SpeechToTextProvider } from './providers/speech-to-text';
import { VoiceTasksService } from './services/voice-tasks';

export {
  type OnDeviceModelStatus,
  type OnDeviceSpeechModel,
  type SpeechToTextError,
  type SpeechToTextHandlers,
  type SpeechToTextOptions,
  SpeechToTextProvider,
  type SpeechToTextSession,
} from './providers/speech-to-text';
export {
  type VoiceTasksRequest,
  VoiceTasksService,
} from './services/voice-tasks';
export { addCaptureRecording } from './utils/capture-recording';
export {
  buildVocabulary,
  cleanDictation,
  type VocabularyTerm,
} from './utils/clean-dictation';
export { compressRecording } from './utils/compress-recording';
export { insertTasks } from './utils/insert-tasks';
export { appendDictation, splitDictatedTasks } from './utils/split-tasks';
export { writeCapture } from './utils/write-capture';

export const configureVoiceTasksModule = (framework: Framework) => {
  framework.service(VoiceTasksService, container => {
    return new VoiceTasksService(container.getOptional(SpeechToTextProvider));
  });
};
