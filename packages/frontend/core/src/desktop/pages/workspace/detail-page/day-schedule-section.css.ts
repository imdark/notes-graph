import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

// Align with the editor's content column (same vars the editor + backlink panel use).
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

// Per-project subheader within the To Do list; the "Inbox" group reuses it.
export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 6px 2px',
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVar('textSecondaryColor'),
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const headerButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '2px 6px 6px',
  width: '100%',
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  color: cssVar('textSecondaryColor'),
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
});

export const chevron = style({
  display: 'inline-block',
  width: '10px',
  fontSize: '10px',
});

export const checkbox = style({
  width: '14px',
  height: '14px',
  borderRadius: '4px',
  border: `1.5px solid ${cssVar('textSecondaryColor')}`,
  flexShrink: 0,
});

export const more = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 8px',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: cssVar('textPrimaryColor') },
  },
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 8px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: cssVar('fontSm'),
  selectors: {
    '&:hover': { background: cssVar('hoverColor') },
  },
});

export const dot = style({
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: '#7C6CFF',
  flexShrink: 0,
});

export const title = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const badge = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  padding: '1px 8px',
  borderRadius: '999px',
  border: `1px solid ${cssVar('borderColor')}`,
  flexShrink: 0,
});

export const todoText = style({
  flexShrink: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// muted ancestor breadcrumb shown after a nested todo's text
export const todoTrail = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  opacity: 0.7,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 2,
  minWidth: 0,
});

// clickable, dotted-underlined human time stamp / range on a scheduled block
export const timeChip = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  textDecoration: 'underline dotted',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
  flexShrink: 0,
  selectors: {
    '&:hover': { color: cssVar('primaryColor') },
  },
});
