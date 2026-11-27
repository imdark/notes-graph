import { bodyEmphasized } from '@toeverything/theme/typography';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

/** Fills the screen: the chat needs the height for its messages and input. */
export const sheet = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: 0,
  background: cssVarV2('layer/background/primary'),
  // Clear the status bar and the home indicator.
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  flexShrink: 0,
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const title = style([
  bodyEmphasized,
  {
    color: cssVarV2('text/primary'),
  },
]);

/** The chat lays itself out to the height it is given. */
export const body = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const loading = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: cssVarV2('text/secondary'),
  fontSize: 14,
});
