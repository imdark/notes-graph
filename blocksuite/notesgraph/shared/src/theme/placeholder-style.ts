import { ColorScheme } from '@blocksuite/notesgraph-model';

export function inferColorSchemeFromThemeMode(
  themeMode?: string | null
): ColorScheme {
  return themeMode === 'dark' ? ColorScheme.Dark : ColorScheme.Light;
}

export function getNotesGraphPlaceholderFillColor(colorScheme: ColorScheme) {
  return colorScheme === ColorScheme.Dark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.04)';
}

export function getNotesGraphPlaceholderStrokeColor(colorScheme: ColorScheme) {
  return colorScheme === ColorScheme.Dark
    ? 'rgba(255, 255, 255, 0.04)'
    : 'rgba(0, 0, 0, 0.02)';
}
