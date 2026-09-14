import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const trigger = style({
  padding: '4px 0px 4px 4px',
  borderRadius: '4px',
  justifyContent: 'space-between',
  display: 'flex',
  fontSize: cssVar('fontSm'),
  fontWeight: 400,
  height: '30px',
});

export const disabledTrigger = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/disable'),
  marginRight: '4px',
});

export const themePanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  marginTop: '8px',
  paddingTop: '8px',
  paddingLeft: '4px',
  paddingRight: '4px',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const swatchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

export const swatch = style({
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  cursor: 'pointer',
  padding: 0,
  selectors: {
    '&[data-active="true"]': {
      outline: `2px solid ${cssVar('primaryColor')}`,
      outlineOffset: '1px',
    },
  },
});

export const resyncButton = style({
  marginTop: '4px',
  alignSelf: 'flex-start',
});
