/* CSS variables. You need to handle all places where `CSS variables` are marked. */

import { LINE_COLORS } from '@blocksuite/notesgraph-model';
import {
  cssVar,
  type NotesGraphCssVariables,
  type NotesGraphTheme,
} from '@toeverything/theme';
export { cssVar } from '@toeverything/theme';
import { cssVarV2, type NotesGraphThemeKeyV2 } from '@toeverything/theme/v2';
import { unsafeCSS } from 'lit';
export { cssVarV2 } from '@toeverything/theme/v2';
export const ColorVariables = [
  '--notesgraph-brand-color',
  '--notesgraph-primary-color',
  '--notesgraph-secondary-color',
  '--notesgraph-tertiary-color',
  '--notesgraph-hover-color',
  '--notesgraph-icon-color',
  '--notesgraph-icon-secondary',
  '--notesgraph-border-color',
  '--notesgraph-divider-color',
  '--notesgraph-placeholder-color',
  '--notesgraph-quote-color',
  '--notesgraph-link-color',
  '--notesgraph-edgeless-grid-color',
  '--notesgraph-success-color',
  '--notesgraph-warning-color',
  '--notesgraph-error-color',
  '--notesgraph-processing-color',
  '--notesgraph-text-emphasis-color',
  '--notesgraph-text-primary-color',
  '--notesgraph-text-secondary-color',
  '--notesgraph-text-disable-color',
  '--notesgraph-black-10',
  '--notesgraph-black-30',
  '--notesgraph-black-50',
  '--notesgraph-black-60',
  '--notesgraph-black-80',
  '--notesgraph-black-90',
  '--notesgraph-black',
  '--notesgraph-white-10',
  '--notesgraph-white-30',
  '--notesgraph-white-50',
  '--notesgraph-white-60',
  '--notesgraph-white-80',
  '--notesgraph-white-90',
  '--notesgraph-white',
  '--notesgraph-background-code-block',
  '--notesgraph-background-tertiary-color',
  '--notesgraph-background-processing-color',
  '--notesgraph-background-error-color',
  '--notesgraph-background-warning-color',
  '--notesgraph-background-success-color',
  '--notesgraph-background-primary-color',
  '--notesgraph-background-secondary-color',
  '--notesgraph-background-modal-color',
  '--notesgraph-background-overlay-panel-color',
  '--notesgraph-tag-blue',
  '--notesgraph-tag-green',
  '--notesgraph-tag-teal',
  '--notesgraph-tag-white',
  '--notesgraph-tag-purple',
  '--notesgraph-tag-red',
  '--notesgraph-tag-pink',
  '--notesgraph-tag-yellow',
  '--notesgraph-tag-orange',
  '--notesgraph-tag-gray',
  ...LINE_COLORS,
  '--notesgraph-tooltip',
  '--notesgraph-blue',
];

export const SizeVariables = [
  '--notesgraph-font-h-1',
  '--notesgraph-font-h-2',
  '--notesgraph-font-h-3',
  '--notesgraph-font-h-4',
  '--notesgraph-font-h-5',
  '--notesgraph-font-h-6',
  '--notesgraph-font-base',
  '--notesgraph-font-sm',
  '--notesgraph-font-xs',
  '--notesgraph-line-height',
  '--notesgraph-z-index-modal',
  '--notesgraph-z-index-popover',
];

export const FontFamilyVariables = [
  '--notesgraph-font-family',
  '--notesgraph-font-number-family',
  '--notesgraph-font-code-family',
];

export const StyleVariables = [
  '--notesgraph-editor-width',

  '--notesgraph-theme-mode',
  '--notesgraph-editor-mode',
  /* --notesgraph-palette-transparent: special values added for the sake of logical consistency. */
  '--notesgraph-palette-transparent',

  '--notesgraph-popover-shadow',
  '--notesgraph-menu-shadow',
  '--notesgraph-float-button-shadow',
  '--notesgraph-shadow-1',
  '--notesgraph-shadow-2',
  '--notesgraph-shadow-3',

  '--notesgraph-paragraph-space',
  '--notesgraph-popover-radius',
  '--notesgraph-scale',
  ...SizeVariables,
  ...ColorVariables,
  ...FontFamilyVariables,
] as const;

type VariablesType = typeof StyleVariables;
export type CssVariableName = Extract<
  VariablesType[keyof VariablesType],
  string
>;

export type CssVariablesMap = Record<CssVariableName, string>;

export const unsafeCSSVar = (
  key: keyof NotesGraphCssVariables | keyof NotesGraphTheme,
  fallback?: string
) => unsafeCSS(cssVar(key, fallback));

export const unsafeCSSVarV2 = (key: NotesGraphThemeKeyV2, fallback?: string) =>
  unsafeCSS(cssVarV2(key, fallback));
