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
  minWidth: 480,
  maxWidth: 560,
});

/**
 * The scrolling half: every field lives here, the actions stay pinned.
 *
 * Scrolling is Radix's (via Scrollable), not the browser's - global.css turns
 * native scrollbars off app-wide, so an overflow:auto div here would scroll
 * with no visible bar at all.
 */
export const editorScrollRoot = style({
  minHeight: 0,
});

export const editorBody = style({
  /**
   * The cap lives here, on the element that actually scrolls.
   *
   * Capping an ancestor and letting Radix's viewport inherit `height: 100%`
   * does not work: the percentage has no definite box to resolve against, so
   * the viewport grows to its full content height, gets clipped by the root's
   * overflow:hidden, and reports no overflow - leaving the scrollbar stuck at
   * data-state="hidden" no matter how long the form is.
   */
  maxHeight: 'min(58vh, 520px)',
  // Keep the scrollbar clear of the inputs.
  paddingRight: 8,
});

/**
 * Radix measures overflow with a ResizeObserver on the content wrapper it puts
 * inside the viewport, but the shared Scrollable style collapses that wrapper
 * with `display: contents !important`. A box with no size reports no overflow,
 * so the scrollbar stays `data-state="hidden"` however tall the form gets -
 * which is exactly the "it doesn't look scrollable" complaint.
 *
 * Give the wrapper a real box back (and carry the field layout on it). The
 * doubled class is what wins against the shared rule's !important without
 * depending on stylesheet order.
 */
globalStyle(`${editorBody}${editorBody} > :first-child`, {
  display: 'flex !important',
  flexDirection: 'column',
  gap: 16,
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
  flexShrink: 0,
  paddingTop: 16,
  marginTop: 4,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

// --- tag input ---

export const tagInput = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  minHeight: 36,
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
});

export const tag = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 4px 2px 8px',
  borderRadius: 6,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/hoverOverlay'),
  selectors: {
    // Tools that change the user's files read differently from read-only ones.
    '&[data-mutates="true"]': {
      color: cssVarV2('status/error'),
      background: cssVarV2('layer/background/error'),
    },
  },
});

export const tagRemove = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  border: 'none',
  padding: 0,
  borderRadius: 4,
  cursor: 'pointer',
  color: 'inherit',
  background: 'transparent',
  fontSize: 12,
  lineHeight: 1,
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
  },
});

export const tagAdd = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 6,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  background: 'transparent',
  color: cssVarV2('text/secondary'),
  fontSize: cssVar('fontXs'),
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: cssVarV2('text/primary') },
  },
});

export const tagMenuItem = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const tagMenuDesc = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
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
