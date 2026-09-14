import { css } from '@emotion/css';
import { cssVarV2 } from '@toeverything/theme/v2';

export const databaseBlockStyles = css({
  display: 'block',
  borderRadius: '8px',
  backgroundColor: 'var(--notesgraph-background-primary-color)',
  padding: '8px',
  margin: '8px -8px -8px',
});

export const databaseBlockSelectedStyles = css({
  backgroundColor: 'var(--notesgraph-hover-color)',
  borderRadius: '4px',
});

export const databaseOpsStyles = css({
  padding: '2px',
  borderRadius: '4px',
  display: 'flex',
  cursor: 'pointer',
  alignItems: 'center',
  height: 'max-content',
  fontSize: '16px',
  color: cssVarV2.icon.primary,
  ':hover': {
    backgroundColor: 'var(--notesgraph-hover-color)',
  },

  '@media print': {
    display: 'none',
  },
});

export const databaseHeaderBarStyles = css({
  '@media print': {
    display: 'none !important',
  },
});

export const databaseTitleStyles = css({
  overflow: 'hidden',
});

export const databaseHeaderContainerStyles = css({
  marginBottom: '16px',
  display: 'flex',
  flexDirection: 'column',
});

export const databaseTitleRowStyles = css({
  display: 'flex',
  gap: '12px',
  marginBottom: '8px',
  alignItems: 'center',
});

export const databaseToolbarRowStyles = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
});

export const databaseViewBarContainerStyles = css({
  flex: 1,
});

export const databaseContentStyles = css({
  position: 'relative',
  backgroundColor: 'var(--notesgraph-background-primary-color)',
  borderRadius: '4px',
});

// Applied on top of databaseContentStyles when the current view is the list
// (task) view, to set it apart from the surrounding page as a distinct card.
export const databaseContentListStyles = css({
  backgroundColor: 'var(--notesgraph-background-secondary-color)',
  border: '1px solid var(--notesgraph-border-color)',
  borderRadius: '8px',
  padding: '12px 16px',
});

export const dbCollapseToggleStyles = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  flexShrink: 0,
  cursor: 'pointer',
  borderRadius: '4px',
  fontSize: '30px',
  lineHeight: 1,
  color: cssVarV2('icon/primary'),
  userSelect: 'none',
  ':hover': {
    backgroundColor: 'var(--notesgraph-hover-color)',
  },
});

export const dbCollapsedHeaderStyles = css({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '2px 0',
});

export const dbCollapsedTitleStyles = css({
  fontWeight: 600,
  fontSize: 'var(--notesgraph-font-base)',
  color: 'var(--notesgraph-text-primary-color)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const queryScopeBarStyles = css({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '6px',
  marginBottom: '8px',
  fontSize: 'var(--notesgraph-font-xs)',
  color: 'var(--notesgraph-text-secondary-color)',
});

export const queryScopeChipStyles = css({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 8px',
  borderRadius: '10px',
  backgroundColor: 'var(--notesgraph-background-secondary-color)',
  border: '1px solid var(--notesgraph-border-color)',
  whiteSpace: 'nowrap',
  lineHeight: '18px',
});

export const queryScopeEditStyles = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  padding: '1px 6px',
  borderRadius: '10px',
  cursor: 'pointer',
  userSelect: 'none',
  color: 'var(--notesgraph-text-secondary-color)',
  ':hover': {
    backgroundColor: 'var(--notesgraph-hover-color)',
  },
});
