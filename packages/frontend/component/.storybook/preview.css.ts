import { globalStyle } from '@vanilla-extract/css';

globalStyle('*', {
  margin: 0,
  padding: 0,
});

globalStyle('body', {
  color: 'var(--notesgraph-text-primary-color)',
  fontFamily: 'var(--notesgraph-font-family)',
  fontSize: 'var(--notesgraph-font-base)',
  lineHeight: 'var(--notesgraph-font-height)',
  backgroundColor: 'var(--notesgraph-background-primary-color)',
});

globalStyle('.docs-story', {
  backgroundColor: 'var(--notesgraph-background-primary-color)',
});

globalStyle('body.sb-main-fullscreen', {
  overflowY: 'auto',
});
