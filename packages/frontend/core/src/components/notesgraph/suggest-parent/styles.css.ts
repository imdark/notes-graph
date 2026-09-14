import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const banner = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: '8px 16px 0',
  padding: 12,
  borderRadius: 12,
  backgroundColor: cssVarV2.layer.background.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const bannerHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 13,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
});

export const dismissButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  color: cssVarV2.icon.primary,
  fontSize: 20,
});

export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const groupLabel = style({
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
});

export const chips = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
});

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  padding: '6px 10px',
  borderRadius: 999,
  fontSize: 14,
  lineHeight: '20px',
  color: cssVarV2.text.primary,
  backgroundColor: cssVarV2.layer.background.primary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  transition: 'background-color .15s, border-color .15s',
  selectors: {
    // Suggestion / topic / add chips are clickable as a whole (role="button")
    // and get the pointer + hover. A current-parent chip has two separate
    // targets instead — its label (peek) and its × (remove) — each styled below.
    '&[role="button"]': { cursor: 'pointer' },
    '&[role="button"]:hover': {
      backgroundColor: cssVarV2.layer.background.hoverOverlay,
      borderColor: cssVarV2.layer.insideBorder.blackBorder,
    },
  },
});

// The label of a current-parent chip: clicking it peeks at that parent note,
// so it reads as clickable (pointer + peek icon that brightens on hover).
export const peekLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  cursor: 'pointer',
  color: cssVarV2.text.primary,
  selectors: {
    '&:hover': { color: cssVarV2.button.primary },
  },
});

export const peekIcon = style({
  display: 'inline-flex',
  fontSize: 16,
  flexShrink: 0,
  color: cssVarV2.icon.secondary,
  transition: 'color .15s',
  selectors: {
    [`${peekLabel}:hover &`]: { color: cssVarV2.button.primary },
  },
});

// Variants must come after `chip`: same specificity, so stylesheet order
// decides, and `chip`'s `border` shorthand would otherwise win.
export const addChip = style({
  borderStyle: 'dashed',
  color: cssVarV2.text.secondary,
});

// "Create new topic" chips — dashed + brand-colored so they read as
// "this makes something new", unlike the solid existing-note chips.
export const topicChip = style({
  borderStyle: 'dashed',
  borderColor: cssVarV2.button.primary,
  color: cssVarV2.button.primary,
});

export const chipLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 200,
});

export const chipIcon = style({
  display: 'inline-flex',
  fontSize: 16,
  color: cssVarV2.icon.primary,
  flexShrink: 0,
  transition: 'color .15s',
  selectors: {
    // The × (remove) icon on a current-parent chip is separately clickable —
    // give it its own pointer + a red hover so it reads as a distinct "remove"
    // target, not part of the chip body.
    '&[role="button"]': { cursor: 'pointer' },
    '&[role="button"]:hover': { color: cssVarV2.button.error },
  },
});

// Must come after `chipIcon` so the inherit wins inside topic chips.
export const topicChipIcon = style({
  color: 'inherit',
});

// Parent picker (inside the more-menu sub-sheet)
export const pickerRoot = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 260,
  maxHeight: '50vh',
});

export const pickerInput = style({
  margin: '4px 0',
});

export const pickerList = style({
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
});

export const pickerEmpty = style({
  padding: '12px 8px',
  fontSize: 13,
  color: cssVarV2.text.secondary,
  textAlign: 'center',
});
