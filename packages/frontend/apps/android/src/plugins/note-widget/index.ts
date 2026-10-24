import { registerPlugin } from '@capacitor/core';

import type { NoteWidgetPlugin } from './definitions';

const NoteWidget = registerPlugin<NoteWidgetPlugin>('NoteWidget');

export * from './definitions';
export { NoteWidget };
