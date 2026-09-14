import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingTop: 12,
});

export const header = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
});

export const title = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
  color: cssVarV2('text/primary'),
});

export const desc = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  marginTop: 2,
});

export const actions = style({
  display: 'flex',
  gap: 8,
  flexShrink: 0,
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
  gap: 10,
});

export const tile = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '10px 6px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  cursor: 'pointer',
  transition: 'border-color .15s, background .15s',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const tileActive = style({
  borderColor: cssVar('primaryColor'),
  boxShadow: `0 0 0 1px ${cssVar('primaryColor')}`,
});

export const swatch = style({
  width: 40,
  height: 40,
  borderRadius: '50%',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  flexShrink: 0,
});

export const defaultSwatch = style({
  background: `conic-gradient(from 180deg, #1E96EB, #7C3AED, #059669, #D97706, #E11D48, #1E96EB)`,
});

export const tileName = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/primary'),
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
