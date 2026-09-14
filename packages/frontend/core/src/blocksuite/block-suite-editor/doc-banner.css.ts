import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const bannerImage = style({
  width: '100%',
  maxHeight: 220,
  objectFit: 'cover',
  borderRadius: 8,
  display: 'block',
  marginBottom: 12,
});

export const bannerWrapper = style({
  position: 'relative',
});

export const bannerActions = style({
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'flex',
  gap: 4,
  opacity: 0,
  transition: 'opacity 0.15s ease',
});

// vanilla-extract only allows `&`-targeted selectors inside style();
// descendant rules must be globalStyle
globalStyle(`${bannerWrapper}:hover [data-banner-actions]`, {
  opacity: 1,
});

export const headerRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  position: 'relative',
});

export const addButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: cssVarV2.text.secondary,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const addButtonIcon = style({
  color: cssVarV2.icon.secondary,
  fontSize: 16,
});

export const menuPanel = style({
  width: 420,
  maxWidth: '90vw',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const panel = style({
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 10,
  width: 420,
  maxWidth: '90vw',
  padding: 12,
  borderRadius: 8,
  background: cssVarV2.layer.background.overlayPanel,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const panelTabs = style({
  display: 'flex',
  gap: 4,
});

export const panelTab = style({
  padding: '4px 10px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: cssVarV2.text.secondary,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&[data-active="true"]': {
      background: cssVarV2.layer.background.hoverOverlay,
      color: cssVarV2.text.primary,
    },
  },
});

export const promptRow = style({
  display: 'flex',
  gap: 6,
});

export const promptInput = style({
  flex: 1,
  padding: '6px 8px',
  borderRadius: 4,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  color: cssVarV2.text.primary,
  fontSize: 12,
});

export const statusText = style({
  color: cssVarV2.text.secondary,
  fontSize: 11,
});

export const candidates = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
});

export const candidate = style({
  width: '100%',
  borderRadius: 6,
  cursor: 'pointer',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  objectFit: 'cover',
  display: 'block',
  selectors: {
    '&:hover': {
      borderColor: cssVarV2.button.primary,
    },
  },
});

export const candidateIcon = style({
  aspectRatio: '1',
});

// Grid of bundled preset banners in the Add-banner menu.
export const presets = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  maxHeight: 220,
  overflowY: 'auto',
});

export const preset = style({
  width: '100%',
  aspectRatio: '3',
  borderRadius: 6,
  cursor: 'pointer',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  objectFit: 'cover',
  display: 'block',
  selectors: {
    '&:hover': {
      borderColor: cssVarV2.button.primary,
    },
  },
});

export const candidateBanner = style({
  aspectRatio: '3',
});

// Right-hand pane inside the Add-icon popup, beside the emoji/icon grid.
export const aiIconSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  width: 172,
  flexShrink: 0,
  borderLeft: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  marginLeft: 4,
  overflowY: 'auto',
});

export const aiIconPaneTitle = style({
  color: cssVarV2.text.secondary,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const emojiCandidates = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
});

export const emojiCandidate = style({
  fontSize: 22,
  lineHeight: 1,
  padding: 4,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'Inter',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const aiIconCandidates = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
});
