import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

// Tints that read on both the light and dark themes.
const removedBg = 'rgba(235, 87, 87, 0.12)';
const removedWord = 'rgba(235, 87, 87, 0.38)';
const addedBg = 'rgba(39, 174, 96, 0.12)';
const addedWord = 'rgba(39, 174, 96, 0.38)';

export const diff = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const file = style({
  borderRadius: 6,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
});

export const fileHeader = style({
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '4px 8px',
  background: cssVarV2('layer/background/secondary'),
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});

export const path = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  direction: 'rtl',
  textAlign: 'left',
});

export const stats = style({
  flexShrink: 0,
});

export const added = style({ color: 'rgb(39, 174, 96)' });
export const removed = style({ color: 'rgb(235, 87, 87)' });

export const body = style({
  maxHeight: 320,
  overflow: 'auto',
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.55,
});

/**
 * As wide as the longest line, so lines scroll sideways instead of wrapping.
 * Every row is a `1fr 1fr` grid at this width, keeping the columns aligned.
 */
export const lines = style({
  width: 'max-content',
  minWidth: '100%',
});

export const columnsHeader = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVarV2('text/tertiary'),
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

// Child selectors aren't allowed in `selectors` (it must target `&` itself).
globalStyle(`${columnsHeader} > span`, { padding: '2px 8px' });
globalStyle(`${columnsHeader} > span + span`, {
  borderLeft: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const row = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
});

export const singleRow = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
});

export const cell = style({
  minWidth: 0,
  padding: '0 8px 0 20px',
  position: 'relative',
  whiteSpace: 'pre',
  color: cssVarV2('text/primary'),
  selectors: {
    [`${row} > & + &`]: {
      borderLeft: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
    '&::before': {
      position: 'absolute',
      left: 6,
      color: cssVarV2('text/tertiary'),
    },
  },
});

export const cellRemoved = style({
  background: removedBg,
  selectors: { '&::before': { content: '"−"' } },
});

export const cellAdded = style({
  background: addedBg,
  selectors: { '&::before': { content: '"+"' } },
});

/** The gutter side of an addition or removal: nothing on this side. */
export const cellEmpty = style({
  background: `repeating-linear-gradient(-45deg, transparent 0 4px, ${cssVarV2('layer/insideBorder/border')} 4px 5px)`,
  opacity: 0.6,
});

export const wordRemoved = style({
  background: removedWord,
  borderRadius: 2,
});

export const wordAdded = style({
  background: addedWord,
  borderRadius: 2,
});

export const fold = style({
  padding: '1px 8px',
  textAlign: 'left',
  color: cssVarV2('text/tertiary'),
  background: cssVarV2('layer/background/secondary'),
  cursor: 'pointer',
  border: 'none',
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 'inherit',
});

/** Pinned to the left edge so it stays visible while scrolled sideways. */
export const foldLabel = style({
  display: 'inline-block',
  position: 'sticky',
  left: 8,
});
