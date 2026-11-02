import {
  bodyEmphasized,
  bodyRegular,
  footnoteRegular,
} from '@toeverything/theme/typography';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  padding: '24px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const sectionTitle = style([
  footnoteRegular,
  {
    color: cssVarV2('text/secondary'),
    padding: '0 4px',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
]);

export const item = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '16px 12px',
  background: cssVarV2('layer/background/mobile/secondary'),
  borderRadius: 12,
  minWidth: 0,
});

export const itemHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
});

export const itemName = style([
  bodyEmphasized,
  {
    color: cssVarV2('text/primary'),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
]);

export const itemMeta = style([
  footnoteRegular,
  {
    color: cssVarV2('text/tertiary'),
    overflowWrap: 'anywhere',
  },
]);

export const itemActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexShrink: 0,
});

export const note = style([
  bodyRegular,
  {
    color: cssVarV2('text/secondary'),
    padding: '16px 12px',
    background: cssVarV2('layer/background/mobile/secondary'),
    borderRadius: 12,
  },
]);

export const error = style([
  footnoteRegular,
  {
    color: cssVarV2('status/error'),
    marginTop: 4,
  },
]);
