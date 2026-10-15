import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const page = style({
  height: '100%',
  overflowY: 'auto',
  background: cssVarV2('layer/background/primary'),
});

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 880,
  margin: '0 auto',
  padding: '40px 20px 64px',
  '@media': {
    'screen and (max-width: 640px)': { padding: '20px 12px 40px' },
  },
});

export const header = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const title = style({
  margin: 0,
  fontSize: cssVar('fontH4'),
  fontWeight: 600,
  lineHeight: 1.3,
  color: cssVarV2('text/primary'),
  overflowWrap: 'anywhere',
});

export const questions = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: '100%',
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const question = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** The section stacks to the left; the log needs the full width. */
export const transcript = style({
  width: '100%',
  minWidth: 0,
});

export const answer = style({
  color: cssVarV2('text/secondary'),
});
