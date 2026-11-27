import { VoiceTasksService } from '@notesgraph/core/modules/voice-tasks';
import type { FrameworkProvider } from '@notesgraph/infra';

import type { ChatSpeechToText } from './dictation';

/**
 * The recognizer Capture uses (the browser's, or the phone's own), for a chat
 * to hand to its input. Undefined where the platform has none, which leaves
 * the input without a microphone button.
 */
export function chatSpeechToText(
  framework: FrameworkProvider
): ChatSpeechToText | undefined {
  const voice = framework.getOptional(VoiceTasksService);
  if (!voice?.supported) {
    return undefined;
  }
  return { listen: handlers => voice.listen(handlers) };
}
