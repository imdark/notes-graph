import { css } from '@emotion/css';
import { baseTheme } from '@toeverything/theme';

export const relationCellStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  alignItems: 'center',
  overflow: 'hidden',
  width: '100%',
  padding: '2px 0',
  fontFamily: baseTheme.fontSansFamily,
  fontSize: 'var(--data-view-cell-text-size)',
  lineHeight: 'var(--data-view-cell-text-line-height)',
  color: 'var(--notesgraph-text-primary-color)',
});

export const relationChipStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '120px',
  padding: '0 8px',
  height: '20px',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: '12px',
  backgroundColor: 'var(--notesgraph-tag-gray, var(--notesgraph-hover-color))',
  color: 'var(--notesgraph-text-primary-color)',
});
