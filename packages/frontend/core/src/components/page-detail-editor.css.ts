import { style } from '@vanilla-extract/css';
export const editor = style({
  flex: 1,
  selectors: {
    '&.full-screen': {
      width: '100%',
      minWidth: 0,
      vars: {
        '--notesgraph-editor-width': '100%',
        '--notesgraph-editor-side-padding': '72px',
      },
    },
    // shared (public) pages have no sidebars — let the doc breathe wider
    // than the in-app reading column instead of cramping in the middle
    '&.is-public': {
      vars: {
        '--notesgraph-editor-width': 'min(1240px, calc(100% - 120px))',
        '--notesgraph-editor-side-padding': '48px',
      },
    },
  },
  '@media': {
    'screen and (max-width: 800px)': {
      selectors: {
        '&.is-public': {
          vars: {
            '--notesgraph-editor-width': '100%',
            '--notesgraph-editor-side-padding': '24px',
          },
        },
      },
    },
  },
});
