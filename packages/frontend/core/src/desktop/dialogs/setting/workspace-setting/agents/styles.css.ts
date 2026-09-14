import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const main = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
});

export const listHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});

export const groupTitle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const groupDesc = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  marginTop: 2,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  overflow: 'hidden',
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
  },
});

export const rowEmoji = style({
  fontSize: 18,
  width: 24,
  textAlign: 'center',
  flexShrink: 0,
});

export const rowText = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
});

export const rowName = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
});

export const empty = style({
  padding: '20px 12px',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

// --- editor ---

export const editor = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 480,
  maxWidth: 560,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const label = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVarV2('text/secondary'),
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
});

export const hint = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
});

export const textarea = style({
  fontFamily: 'inherit',
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  padding: '8px 10px',
  minHeight: 120,
  resize: 'vertical',
  selectors: {
    '&:focus': {
      outline: 'none',
      borderColor: cssVarV2('layer/insideBorder/primaryBorder'),
    },
  },
});

export const checkGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
  gap: 8,
});

export const check = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  cursor: 'pointer',
});

export const editorActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
});

export const scopeBadge = style({
  fontSize: cssVar('fontXs'),
  padding: '1px 6px',
  borderRadius: 4,
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVarV2('text/secondary'),
  flexShrink: 0,
});

export const iconRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

// Keeps the chosen (or default) icon at a readable size next to the pen.
export const iconPreview = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  fontSize: 20,
  lineHeight: 1,
  borderRadius: 6,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('icon/primary'),
});

export const select = style({
  fontFamily: 'inherit',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  padding: '6px 10px',
});
