import {
  darkTheme,
  lightTheme,
  type NotesGraphTheme,
} from '@toeverything/theme';
import {
  darkThemeV2,
  lightThemeV2,
  type NotesGraphThemeKeyV2,
} from '@toeverything/theme/v2';
import { useTheme } from 'next-themes';

export const useThemeValueV2 = (key: NotesGraphThemeKeyV2) => {
  const { resolvedTheme } = useTheme();

  return resolvedTheme === 'dark' ? darkThemeV2[key] : lightThemeV2[key];
};

export const useThemeValueV1 = (
  key: keyof Omit<NotesGraphTheme, 'editorMode'>
) => {
  const { resolvedTheme } = useTheme();

  return resolvedTheme === 'dark' ? darkTheme[key] : lightTheme[key];
};
