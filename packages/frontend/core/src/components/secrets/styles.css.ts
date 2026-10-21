import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 760,
  margin: '0 auto',
  width: '100%',
});

export const intro = style({
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
});

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const sectionTitle = style({
  flex: 1,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: cssVarV2('text/secondary'),
});

export const sectionCount = style({
  marginLeft: 6,
  fontWeight: 500,
  color: cssVarV2('text/tertiary'),
});

export const empty = style({
  padding: '20px 16px',
  borderRadius: 12,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  overflow: 'hidden',
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  minWidth: 0,
  selectors: {
    '& + &': {
      borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const rowText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
});

// Names are environment variable names, so they read as code.
export const name = style({
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: 13,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const meta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const actions = style({
  display: 'flex',
  flexShrink: 0,
  gap: 4,
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  selectors: {
    [`${list} > &`]: {
      borderRadius: 0,
      border: 'none',
      background: cssVarV2('layer/background/secondary'),
    },
    [`${list} > & + *, ${list} > * + &`]: {
      borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const fieldError = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('status/error'),
});

export const formActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});
