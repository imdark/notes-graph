import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const mainContainer = style({
  containerType: 'inline-size',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
  borderTop: `0.5px solid transparent`,
  transition: 'border-color 0.2s',
  selectors: {
    '&[data-dynamic-top-border="false"]': {
      borderColor: cssVar('borderColor'),
    },
    '&[data-has-scroll-top="true"]': {
      borderColor: cssVar('borderColor'),
    },
  },
});

export const editorContainer = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  zIndex: 0,
});

// Floating card pinned to the top-right of the page — over the empty
// gutter between the title column and the right panel edge — so it never
// pushes the document down. Hidden when the window is too narrow for the
// gutter to exist (the graph page still offers the same actions).
export const suggestedParentBanner = style({
  position: 'absolute',
  top: 8,
  right: 24,
  width: 320,
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
  zIndex: 3,
  '@media': {
    'screen and (max-width: 1100px)': {
      display: 'none',
    },
  },
});
// The banner carries its own mobile margins — neutralize them inside the
// aligned desktop column. The attribute selector lifts specificity above the
// banner's own class so stylesheet order can't flip the result.
globalStyle(`${suggestedParentBanner} > [data-testid="suggested-parent-banner"]`, {
  margin: 0,
});
// brings styles of .notesgraph-page-viewport from blocksuite
export const notesgraphDocViewport = style({
  display: 'flex',
  flexDirection: 'column',
  containerName: 'viewport',
  containerType: 'inline-size',
  background: cssVar('backgroundPrimaryColor'),
  '@media': {
    print: {
      display: 'none',
      zIndex: -1,
    },
  },
  selectors: {
    '&[data-dragging="true"]': {
      backgroundColor: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const pageModeViewportContentBox = style({});
globalStyle(
  `${pageModeViewportContentBox} >:first-child:has(>[data-notesgraph-editor-container])`,
  { display: 'table !important', minWidth: '100%' }
);
globalStyle(
  `${pageModeViewportContentBox} >:first-child:has(>[data-notesgraph-editor-container].full-screen)`,
  { display: 'block !important', width: '100%', minWidth: '100%' }
);
globalStyle(
  `${pageModeViewportContentBox} >:first-child:has(>[data-editor-loading="true"]) > [data-editor-loading="true"]`,
  { flex: 1, minHeight: '100%' }
);

export const scrollbar = style({
  marginRight: '4px',
});

export const sidebarScrollArea = style({
  height: '100%',
});

// Parent-suggestions floating card. The anchor is a zero-height,
// position:relative element placed first in the scroll flow, so the absolutely
// positioned card below scrolls up and away with the content (rather than
// sticking to the viewport). It sits at the top-right of the banner area.
export const suggestedParentAnchor = style({
  position: 'relative',
  height: 0,
  zIndex: 2,
});

export const suggestedParentFloat = style({
  position: 'absolute',
  top: 8,
  right: 16,
  width: 300,
  maxWidth: 'calc(100% - 32px)',
  pointerEvents: 'auto',
  '@media': {
    'screen and (max-width: 640px)': {
      display: 'none',
    },
  },
});

/**
 * Don't let a tall suggestion list swallow the banner; scroll within if needed.
 *
 * The cap sits on the scrolling viewport rather than on the card above it:
 * Radix's viewport takes `height: 100%`, and with no definite height to
 * resolve against it grows to its full content height, reports no overflow,
 * and leaves the scrollbar stuck hidden however long the list is.
 */
export const suggestedParentScroller = style({
  maxHeight: 220,
});

/**
 * The shared viewport style is `height: 100%`, which resolves to zero inside
 * this floating card because the card has no height of its own - collapsing
 * the banner entirely. Size to content instead, bounded by the cap above.
 * The doubled class beats the shared rule without relying on source order.
 */
globalStyle(`${suggestedParentScroller}${suggestedParentScroller}`, {
  height: 'auto',
});
