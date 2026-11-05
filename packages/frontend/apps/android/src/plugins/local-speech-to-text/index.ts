import { registerPlugin } from '@capacitor/core';

import type { LocalSpeechToTextPlugin } from './definitions';

const LocalSpeechToText =
  registerPlugin<LocalSpeechToTextPlugin>('LocalSpeechToText');

export * from './definitions';
export { LocalSpeechToText };
