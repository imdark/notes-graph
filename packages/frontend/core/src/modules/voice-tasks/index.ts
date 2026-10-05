import type { Framework } from '@notesgraph/infra';

import { SpeechToTextProvider } from './providers/speech-to-text';
import { VoiceTasksService } from './services/voice-tasks';

export {
  type SpeechToTextError,
  type SpeechToTextHandlers,
  SpeechToTextProvider,
  type SpeechToTextSession,
} from './providers/speech-to-text';
export {
  type VoiceTasksRequest,
  VoiceTasksService,
} from './services/voice-tasks';
export { insertTasks } from './utils/insert-tasks';
export { splitDictatedTasks } from './utils/split-tasks';

export const configureVoiceTasksModule = (framework: Framework) => {
  framework.service(VoiceTasksService, container => {
    return new VoiceTasksService(container.getOptional(SpeechToTextProvider));
  });
};
