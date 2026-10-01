import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

/**
 * Deliberately the same shell as the day-schedule section: on a journal page
 * the two sit one above the other, and two boxes that differ slightly read as
 * a mistake rather than as a distinction.
 */
export const wrapper = style({
  width: '100%',
  maxWidth: cssVar('--notesgraph-editor-width'),
  margin: '0 auto',
  paddingLeft: cssVar('--notesgraph-editor-side-padding', '24'),
  paddingRight: cssVar('--notesgraph-editor-side-padding', '24'),
  paddingTop: '24px',
  boxSizing: 'border-box',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '8px',
  borderRadius: '8px',
  border: `1px solid ${cssVar('borderColor')}`,
  background: cssVar('backgroundSecondaryColor'),
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '2px 6px 6px',
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVar('textSecondaryColor'),
});

export const count = style({
  fontWeight: 400,
});

/** A whole row is the target for the event's note, hence a button. */
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  font: 'inherit',
  fontSize: cssVar('fontSm'),
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVar('primaryColor')}`,
      outlineOffset: '-2px',
    },
  },
});

/** The calendar's own colour, so two calendars are distinguishable at a glance. */
export const dot = style({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: cssVar('primaryColor'),
  flexShrink: 0,
});

export const time = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
  // Times are the column you scan down, so give them a stable width rather
  // than letting each row's title start at a different offset.
  minWidth: '96px',
});

export const title = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** Which calendar an event came from; only worth showing when there are several. */
export const calendarName = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  opacity: 0.7,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 2,
  minWidth: 0,
});

/**
 * "Open note" / "Add note". An event that has a note always says so - that is
 * worth seeing while scanning the day - while "Add note" waits for hover or
 * focus, so a day of note-less events is not a column of identical buttons.
 */
export const noteAction = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexShrink: 0,
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  opacity: 0,
  selectors: {
    [`${row}[data-has-note="true"] &`]: {
      opacity: 1,
    },
    [`${row}:hover &, ${row}:focus-visible &`]: {
      opacity: 1,
    },
  },
});
