import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 16,
  paddingBottom: 32,
  marginTop: 16,
  borderTop: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  // Line up with the editor content column (same width + side padding the
  // doc body and the backlinks panel use).
  width: '100%',
  maxWidth: cssVar('--notesgraph-editor-width'),
  marginLeft: 'auto',
  marginRight: 'auto',
  paddingLeft: cssVar('--notesgraph-editor-side-padding', '24px'),
  paddingRight: cssVar('--notesgraph-editor-side-padding', '24px'),
  '@container': {
    'viewport (width <= 640px)': {
      paddingLeft: 24,
      paddingRight: 24,
    },
  },
});

export const title = style({
  fontSize: 15,
  fontWeight: 600,
  color: cssVarV2.text.primary,
  marginBottom: 4,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const empty = style({
  fontSize: 13,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
  padding: '4px 0',
});

export const addButton = style({
  alignSelf: 'flex-start',
  marginTop: 4,
});
