import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  maxWidth: 720,
});

export const topicsInput = style({
  flex: 1,
});

export const body = style({
  width: '100%',
  height: '100%',
  overflowY: 'auto',
  padding: '8px 24px 48px',
});

export const status = style({
  color: cssVarV2('text/secondary'),
  fontSize: 14,
  padding: '48px 0',
  textAlign: 'center',
});

export const feed = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 12,
  maxWidth: 1200,
  margin: '0 auto',
});

export const loadMore = style({
  display: 'flex',
  justifyContent: 'center',
  padding: '24px 0 8px',
});

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  background: cssVarV2('layer/background/primary'),
  overflow: 'hidden',
  transition: 'border-color .15s, box-shadow .15s',
  selectors: {
    '&:hover': {
      borderColor: cssVarV2('layer/insideBorder/blackBorder'),
    },
  },
});

export const cardImageWrap = style({
  display: 'block',
  width: '100%',
  aspectRatio: '16 / 9',
  padding: 0,
  border: 'none',
  background: cssVarV2('layer/background/secondary'),
  cursor: 'pointer',
  overflow: 'hidden',
});

export const cardImage = style({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
});

export const cardMain = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '14px 16px 10px',
  textAlign: 'left',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  flex: 1,
});

export const cardMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const cardSource = style({
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 160,
});

export const cardTime = style({
  whiteSpace: 'nowrap',
});

export const cardTopic = style({
  marginLeft: 'auto',
  padding: '1px 8px',
  borderRadius: 999,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  whiteSpace: 'nowrap',
});

export const cardTitle = style({
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.35,
  color: cssVarV2('text/primary'),
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const cardSnippet = style({
  fontSize: 13,
  lineHeight: 1.4,
  color: cssVarV2('text/secondary'),
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const cardActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '0 12px 12px',
});
