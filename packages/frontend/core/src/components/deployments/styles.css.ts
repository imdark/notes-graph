import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 900,
  margin: '0 auto',
  width: '100%',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: cssVarV2('text/secondary'),
});

export const sectionCount = style({
  fontWeight: 500,
  color: cssVarV2('text/tertiary'),
});

export const sectionHint = style({
  fontSize: 12,
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

export const rows = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
});

export const row = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  selectors: {
    '& + &': {
      borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const rowBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  flex: 1,
});

export const rowTitle = style({
  fontSize: 14,
  lineHeight: 1.4,
  color: cssVarV2('text/primary'),
  wordBreak: 'break-word',
});

export const rowMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px 12px',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const link = style({
  color: cssVarV2('text/link'),
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  ':hover': { textDecoration: 'underline' },
});

export const shipBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  background: cssVarV2('layer/background/secondary'),
});

export const agentSelect = style({
  flex: '1 1 160px',
  minWidth: 0,
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: 14,
});

export const flagSelect = style([
  agentSelect,
  { flex: '0 0 auto', width: 200, maxWidth: '45%' },
]);

export const runStatus = style({
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const runError = style({
  color: cssVarV2('status/error'),
});

export const rowActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  flexShrink: 0,
});

export const problemForm = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
});

export const problemInput = style({
  flex: '1 1 200px',
  minWidth: 0,
});

/** A branch or repo name field on a Repos row. */
export const repoInput = style({
  flex: '1 1 120px',
  minWidth: 0,
});

export const badge = style({
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  background: cssVarV2('layer/background/tertiary'),
  color: cssVarV2('text/secondary'),
});

export const badgeGood = style([badge, { color: cssVarV2('status/success') }]);

export const badgeBad = style([badge, { color: cssVarV2('status/error') }]);

export const githubBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
});

/** The header line: the page's title row with Repo settings on the right. */
export const header = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

/** A section's title row, its action on the right; wraps on a phone. */
export const sectionHead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

/** The production card, and the set-up and no-token cards. */
export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 14,
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  minWidth: 0,
});

export const cardLine = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px 10px',
  fontSize: 13,
  color: cssVarV2('text/secondary'),
  minWidth: 0,
});

export const cardSubject = style({
  fontSize: 14,
  color: cssVarV2('text/primary'),
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const cardActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 6,
  marginTop: 4,
});

export const sha = style({
  fontFamily: 'var(--affine-font-mono-family, monospace)',
  fontSize: 12,
});

export const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/tertiary'),
  selectors: {
    '&::before': {
      content: '""',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'currentColor',
    },
  },
});

export const pillGood = style([pill, { color: cssVarV2('status/success') }]);

export const pillBad = style([pill, { color: cssVarV2('status/error') }]);

export const pillBusy = style([
  pill,
  { color: cssVarV2('edgeless/line/blue') },
]);

/** A deploy's steps: Build image → Roll the box → Verify. */
export const steps = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
});

export const step = style({
  color: cssVarV2('text/tertiary'),
  selectors: {
    '&[data-status="running"]': {
      color: cssVarV2('edgeless/line/blue'),
      fontWeight: 600,
    },
    '&[data-status="done"]': { color: cssVarV2('status/success') },
    '&[data-status="failed"]': { color: cssVarV2('status/error') },
    '&[data-status="skipped"]': { textDecoration: 'line-through' },
  },
});

/** A History row's summary, a button that opens it. */
export const historyToggle = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px 12px',
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: 13,
  color: cssVarV2('text/primary'),
  textAlign: 'left',
  cursor: 'pointer',
});

/** The pull requests of an opened History row. */
export const historyBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingLeft: 18,
  width: '100%',
});

export const historyRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  selectors: {
    '& + &': {
      borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

/** A settings dialog field: label over input. */
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const dialogBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const dialogActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});
