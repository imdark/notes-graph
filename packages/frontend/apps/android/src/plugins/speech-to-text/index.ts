import { registerPlugin } from '@capacitor/core';

import type { SpeechToTextPlugin } from './definitions';

const SpeechToText = registerPlugin<SpeechToTextPlugin>('SpeechToText');

export * from './definitions';
export { SpeechToText };
