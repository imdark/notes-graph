import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

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

export const rowIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  fontSize: 18,
  flexShrink: 0,
  color: cssVarV2('icon/primary'),
});

export const rowText = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
});

export const rowName = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: cssVar('fontSm'),
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  minWidth: 0,
});

export const rowNameText = style({
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

/**
 * The health dot. Colour carries the state, but so does the label beside it —
 * a dot alone would leave the difference between degraded and offline to hue,
 * which is exactly what a red/green-blind reader cannot see.
 */
export const stateDot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
  background: cssVarV2('text/tertiary'),
  selectors: {
    '&[data-state="online"]': { background: cssVarV2('status/success') },
    '&[data-state="degraded"]': { background: cssVarV2('block/callout/icon/orange') },
    '&[data-state="offline"]': { background: cssVarV2('status/error') },
  },
});

export const badge = style({
  fontSize: cssVar('fontXs'),
  padding: '1px 6px',
  borderRadius: 4,
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVarV2('text/secondary'),
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const empty = style({
  padding: '20px 12px',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

/** The "plugin is off" / "local workspace" / "request failed" panel. */
export const notice = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  padding: 16,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});

export const code = style({
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontXs'),
  padding: '1px 5px',
  borderRadius: 4,
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVarV2('text/primary'),
});

// --- editor ---

export const editor = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 440,
  maxWidth: 560,
});

/**
 * Scrolling here is Radix's (via Scrollable), not the browser's: global.css
 * turns native scrollbars off app-wide, so an overflow:auto div would scroll
 * with no visible bar at all.
 */
export const editorScrollRoot = style({
  minHeight: 0,
});

export const editorBody = style({
  // The cap belongs on the element that actually scrolls — an ancestor cap
  // leaves Radix's viewport with no definite box to resolve `height: 100%`
  // against, and the scrollbar never leaves data-state="hidden".
  maxHeight: 'min(58vh, 520px)',
  paddingRight: 8,
});

/**
 * The shared Scrollable style collapses Radix's content wrapper with
 * `display: contents !important`, and a box with no size reports no overflow.
 * Give it a real box back (and carry the field layout on it); the doubled
 * class outweighs the !important without depending on stylesheet order.
 */
globalStyle(`${editorBody}${editorBody} > :first-child`, {
  display: 'flex !important',
  flexDirection: 'column',
  gap: 16,
});

export const fieldRow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
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

export const errorText = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('status/error'),
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

export const switchRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});

export const editorActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
  paddingTop: 16,
  marginTop: 4,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
