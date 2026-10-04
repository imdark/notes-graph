import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const input = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const description = style({
  margin: 0,
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});

const box = {
  margin: 0,
  maxHeight: 200,
  overflow: 'auto',
  padding: '6px 8px',
  borderRadius: 6,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

/** A shell command, marked with a prompt so it reads as one. */
export const command = style({
  ...box,
  paddingLeft: 22,
  position: 'relative',
  color: cssVarV2('text/primary'),
  selectors: {
    '&::before': {
      content: '"$"',
      position: 'absolute',
      left: 8,
      color: cssVarV2('text/tertiary'),
    },
  },
});

export const fields = style({
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: cssVar('fontXs'),
});

export const field = style({
  display: 'flex',
  gap: 8,
  minWidth: 0,
});

export const blockField = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const label = style({
  flexShrink: 0,
  color: cssVarV2('text/tertiary'),
});

export const value = style({
  margin: 0,
  minWidth: 0,
  fontFamily: cssVar('fontMonoFamily'),
  color: cssVarV2('text/primary'),
  wordBreak: 'break-word',
});

export const blockValue = style({
  ...box,
  color: cssVarV2('text/primary'),
});
