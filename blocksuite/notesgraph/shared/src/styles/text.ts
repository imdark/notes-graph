import type { StyleInfo } from 'lit/directives/style-map.js';

import type { NotesGraphTextAttributes } from '../types';
import { GOAL_TAG } from '../utils/goal-tag';

export function notesgraphTextStyles(
  props: NotesGraphTextAttributes,
  override?: Readonly<StyleInfo>
): StyleInfo {
  let textDecorations = '';
  if (props.underline) {
    textDecorations += 'underline';
  }
  if (props.strike) {
    textDecorations += ' line-through';
  }

  let inlineCodeStyle = {};
  if (props.code) {
    inlineCodeStyle = {
      'font-family': 'var(--notesgraph-font-code-family)',
      background: 'var(--notesgraph-background-code-block)',
      border: '1px solid var(--notesgraph-border-color)',
      'border-radius': '4px',
      color: 'var(--notesgraph-text-primary-color)',
      'font-variant-ligatures': 'none',
      'vertical-align': 'bottom',
      'line-height': 'inherit',
    };
  }

  // Inline task tokens (`#tag`, `@agent`) render as soft chips — the text
  // itself stays intact, only decorated.
  let tokenChipStyle: Readonly<StyleInfo> = {};
  if (props.orgTag?.toLowerCase() === GOAL_TAG) {
    // A long-term goal, not a task: a badge in its own colour so a goal
    // stands out in a list of to-dos.
    tokenChipStyle = {
      // The text-highlight pair is themed for light and dark alike.
      color: 'var(--notesgraph-text-highlight-foreground-orange, #b25e00)',
      'background-color':
        'var(--notesgraph-text-highlight-orange, rgba(255, 166, 0, 0.18))',
      'border-radius': '10px',
      padding: '0 6px',
      'font-size': '0.8em',
      'font-weight': '600',
      'text-transform': 'uppercase',
      'letter-spacing': '0.04em',
    };
  } else if (props.orgTag != null) {
    tokenChipStyle = {
      color: 'var(--notesgraph-brand-color, #8b7dff)',
      'background-color': 'rgba(139, 125, 255, 0.13)',
      'border-radius': '4px',
      padding: '0 3px',
      'font-size': '0.92em',
      'font-weight': '500',
    };
  } else if (props.orgMention != null) {
    tokenChipStyle = {
      color: '#1e96eb',
      'background-color': 'rgba(30, 150, 235, 0.12)',
      'border-radius': '4px',
      padding: '0 3px',
      'font-size': '0.92em',
      'font-weight': '600',
    };
  }

  return {
    'font-weight': props.bold ? 'bolder' : 'inherit',
    'font-style': props.italic ? 'italic' : 'normal',
    'background-color': props.background ? props.background : undefined,
    color: props.color ? props.color : undefined,
    'text-decoration': textDecorations.length > 0 ? textDecorations : 'none',
    ...inlineCodeStyle,
    ...tokenChipStyle,
    ...override,
  };
}
