import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { keyframes, style } from '@vanilla-extract/css';

export const root = style({
  height: '100%',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '12px 16px 24px',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'flex-start',
});

export const sectionLabel = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVarV2('text/secondary'),
});

export const empty = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  margin: 0,
});

export const hint = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
});

export const agentList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
});

export const agentButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontSm'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:disabled': { cursor: 'default', opacity: 0.6 },
  },
});

export const agentEmoji = style({
  fontSize: 16,
  flexShrink: 0,
});

export const agentName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const agentRunning = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  flexShrink: 0,
});

export const output = style({
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
  margin: 0,
});

export const error = style({
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('status/error'),
  margin: 0,
});

export const runList = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  overflow: 'hidden',
});

export const runText = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
});

export const runHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 4,
  minWidth: 0,
});

export const runName = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  whiteSpace: 'nowrap',
  // A run's title is its block's text, which can be a whole sentence.
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
});

export const runMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    '&[data-status="error"]': { color: cssVarV2('status/error') },
  },
});

export const runSide = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
  flexShrink: 0,
});

export const runWhen = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
  flexShrink: 0,
});

export const sessionActions = style({
  display: 'flex',
  gap: 8,
});

export const runItem = style({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
  },
});

export const runRowButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
});

export const runActions = style({
  display: 'flex',
  gap: 2,
  paddingRight: 8,
  flexShrink: 0,
  // Out of the way until the row is pointed at; always there on touch.
  opacity: 0,
  selectors: {
    [`${runItem}:hover &, ${runItem}:focus-within &`]: { opacity: 1 },
  },
  '@media': { '(hover: none)': { opacity: 1 } },
});

export const logDialogBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minHeight: 0,
});

export const runDetails = style({
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '6px 16px',
  margin: 0,
  fontSize: cssVar('fontSm'),
});

export const runDetailLabel = style({
  color: cssVarV2('text/secondary'),
});

export const runDetailValue = style({
  margin: 0,
  color: cssVarV2('text/primary'),
  wordBreak: 'break-word',
});

export const runDetailInput = style({
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  padding: '6px 8px',
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
});

export const attachRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
});

export const attachCommand = style({
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  padding: '2px 6px',
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  userSelect: 'all',
});

export const logView = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minHeight: 0,
  minWidth: 0,
});

export const logToolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const logScroll = style({
  height: '55vh',
  // Both axes: lines never wrap, so a long one scrolls sideways.
  overflow: 'auto',
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.55,
  color: cssVarV2('text/primary'),
});

export const logPlaceholder = style({
  padding: '10px 12px',
  color: cssVarV2('text/secondary'),
});

export const logLines = style({
  // Grows to the longest line so every row's highlight spans the full width.
  display: 'inline-block',
  minWidth: '100%',
  padding: '6px 0',
});

export const logLine = style({
  display: 'flex',
  alignItems: 'baseline',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&[data-selected]': {
      background: cssVarV2('layer/background/hoverOverlay'),
      boxShadow: `inset 2px 0 0 ${cssVarV2('button/primary')}`,
    },
  },
});

export const logGutter = style({
  // Stays in view while the text scrolls sideways.
  position: 'sticky',
  left: 0,
  display: 'flex',
  flexShrink: 0,
  gap: 8,
  padding: '0 8px 0 4px',
  marginRight: 8,
  background: cssVarV2('layer/background/secondary'),
  borderRight: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  userSelect: 'none',
});

const gutterButton = style({
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  color: cssVarV2('text/tertiary'),
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: cssVarV2('text/link'),
      textDecoration: 'underline',
    },
  },
});

export const logLineNumber = style([gutterButton, { textAlign: 'right' }]);

export const logTime = style([
  gutterButton,
  { minWidth: '9ch', textAlign: 'left' },
]);

export const logLineText = style({
  whiteSpace: 'pre',
  paddingRight: 12,
});

export const logFold = style({
  whiteSpace: 'pre',
  paddingRight: 12,
  border: 'none',
  background: 'none',
  font: 'inherit',
  color: cssVarV2('text/secondary'),
  cursor: 'pointer',
  textAlign: 'left',
  selectors: {
    '&:hover': { color: cssVarV2('text/primary') },
  },
});

export const logToolsToggle = style({
  marginLeft: 'auto',
});

export const statusBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  flexShrink: 0,
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
  selectors: {
    '&[data-status="done"]': { color: cssVarV2('status/success') },
    '&[data-status="error"]': { color: cssVarV2('status/error') },
    // Not button/primary: the brand theme makes that pink, which reads as
    // an error next to the red error badge.
    '&[data-status="running"]': { color: cssVarV2('edgeless/line/blue') },
    '&[data-status="waiting"]': {
      color: cssVarV2('button/pureWhiteText'),
      background: cssVarV2('button/primary'),
    },
  },
});

const pulse = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.3 },
});

export const statusPulse = style({
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
  animation: `${pulse} 1.4s ease-in-out infinite`,
});

export const runDoc = style({
  maxWidth: 220,
  padding: 0,
  border: 'none',
  background: 'transparent',
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/link'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

export const panelFooter = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
});

export const sessionHeadSide = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
});

export const linkButton = style({
  padding: 0,
  border: 'none',
  background: 'transparent',
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/link'),
  cursor: 'pointer',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

export const questionCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${cssVarV2('button/primary')}`,
  background: cssVarV2('layer/background/primary'),
});

export const questionLabel = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVarV2('button/primary'),
});

export const questionText = style({
  margin: 0,
  fontSize: cssVar('fontSm'),
  lineHeight: 1.5,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
});

export const questionDetail = style({
  margin: 0,
  maxHeight: 160,
  overflow: 'auto',
  padding: '6px 8px',
  borderRadius: 6,
  background: cssVarV2('layer/background/secondary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const questionOptions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
});

export const forkPanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
});

export const forkHead = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
});

export const forkMessages = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 320,
  overflow: 'auto',
});

export const forkUser = style({
  alignSelf: 'flex-end',
  maxWidth: '85%',
  margin: 0,
  padding: '6px 10px',
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  fontSize: cssVar('fontSm'),
  lineHeight: 1.5,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
});

export const forkReply = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
});

export const questionInput = style({
  width: '100%',
  resize: 'vertical',
  padding: '6px 8px',
  borderRadius: 6,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontSm'),
  fontFamily: 'inherit',
});
