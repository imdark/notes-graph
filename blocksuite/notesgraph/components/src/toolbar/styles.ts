import {
  combinedDarkCssVariables,
  combinedLightCssVariables,
  type NotesGraphCssVariables,
} from '@toeverything/theme';
import { unsafeCSS } from 'lit';

const toolbarColorKeys: Array<keyof NotesGraphCssVariables> = [
  '--notesgraph-background-overlay-panel-color',
  '--notesgraph-v2-layer-background-overlayPanel' as never,
  '--notesgraph-v2-layer-insideBorder-blackBorder' as never,
  '--notesgraph-v2-icon-primary' as never,
  '--notesgraph-background-error-color',
  '--notesgraph-background-primary-color',
  '--notesgraph-background-tertiary-color',
  '--notesgraph-icon-color',
  '--notesgraph-icon-secondary',
  '--notesgraph-border-color',
  '--notesgraph-divider-color',
  '--notesgraph-text-primary-color',
  '--notesgraph-hover-color',
  '--notesgraph-hover-color-filled',
];

export const lightToolbarStyles = (selector: string) => `
  ${selector}[data-app-theme='light'] {
    ${toolbarColorKeys
      .map(key => `${key}: ${unsafeCSS(combinedLightCssVariables[key])};`)
      .join('\n')}
  }
`;

export const darkToolbarStyles = (selector: string) => `
  ${selector}[data-app-theme='dark'] {
    ${toolbarColorKeys
      .map(key => `${key}: ${unsafeCSS(combinedDarkCssVariables[key])};`)
      .join('\n')}
  }
`;
