import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  flexDirection: 'column',
  // Grows with the calendar events instead of clipping at the viewport, so
  // the document scrolls (the note page scrolls the document the same way).
  minHeight: '100dvh',
  backgroundColor: cssVarV2('layer/background/primary'),
});

export const header = style({
  backgroundColor: cssVarV2('layer/background/primary'),
});

export const headerTitle = style({
  color: cssVarV2('text/primary'),
  fontSize: 17,
  lineHeight: '22px',
  fontWeight: 600,
  letterSpacing: -0.43,
});

export const journalDatePicker = style({
  backgroundColor: cssVarV2('layer/background/primary'),
});
