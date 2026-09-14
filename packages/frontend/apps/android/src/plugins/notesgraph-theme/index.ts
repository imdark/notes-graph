import { registerPlugin } from '@capacitor/core';

import type { NotesGraphThemePlugin } from './definitions';

const NotesGraphTheme =
  registerPlugin<NotesGraphThemePlugin>('NotesGraphTheme');

export * from './definitions';
export { NotesGraphTheme };
