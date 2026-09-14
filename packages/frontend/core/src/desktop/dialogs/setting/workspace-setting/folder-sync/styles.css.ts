import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

const notice = style({
  fontSize: cssVar('fontXs'),
  lineHeight: 1.5,
  padding: '8px 12px',
  borderRadius: 8,
  marginTop: 8,
});

export const error = style([
  notice,
  {
    color: cssVarV2('status/error'),
    background: cssVarV2('layer/background/error'),
  },
]);

export const warning = style([
  notice,
  {
    color: cssVarV2('text/secondary'),
    background: cssVarV2('layer/background/secondary'),
  },
]);
