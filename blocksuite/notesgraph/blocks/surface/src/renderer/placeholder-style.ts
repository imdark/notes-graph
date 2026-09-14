import { type ColorScheme } from '@blocksuite/notesgraph-model';
import { getNotesGraphPlaceholderFillColor } from '@blocksuite/notesgraph-shared/theme';

export function getSurfacePlaceholderFallback(colorScheme: ColorScheme) {
  return getNotesGraphPlaceholderFillColor(colorScheme);
}

export function resolveSurfacePlaceholderColor(colorScheme: ColorScheme) {
  return getSurfacePlaceholderFallback(colorScheme);
}
