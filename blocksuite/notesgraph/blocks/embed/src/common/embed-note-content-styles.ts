import { css } from 'lit';

export const embedNoteContentStyles = css`
  .notesgraph-embed-doc-content-note-blocks notesgraph-divider,
  .notesgraph-embed-doc-content-note-blocks notesgraph-divider > * {
    margin-top: 0px !important;
    margin-bottom: 0px !important;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph,
  .notesgraph-embed-doc-content-note-blocks notesgraph-list {
    margin-top: 4px !important;
    margin-bottom: 4px !important;
    padding: 0 2px;
  }
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-list * {
    margin-top: 0px !important;
    margin-bottom: 0px !important;
    padding-top: 0;
    padding-bottom: 0;
    line-height: 20px;
    font-size: var(--notesgraph-font-xs);
    font-weight: 400;
  }
  .notesgraph-embed-doc-content-note-blocks
    notesgraph-list
    .notesgraph-list-block__prefix {
    height: 20px;
  }
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph .quote {
    padding-left: 15px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h1),
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h2),
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h3),
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h4),
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h5),
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h6) {
    margin-top: 6px !important;
    margin-bottom: 4px !important;
    padding: 0 2px;
  }
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h1) *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h2) *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h3) *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h4) *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h5) *,
  .notesgraph-embed-doc-content-note-blocks notesgraph-paragraph:has(.h6) * {
    margin-top: 0px !important;
    margin-bottom: 0px !important;
    padding-top: 0;
    padding-bottom: 0;
    line-height: 20px;
    font-size: var(--notesgraph-font-xs);
    font-weight: 600;
  }

  .notesgraph-embed-doc-content-note-blocks inline-comment {
    background-color: unset !important;
    border-bottom: unset !important;
  }

  .notesgraph-embed-linked-doc-block.horizontal {
    notesgraph-paragraph,
    notesgraph-list {
      margin-top: 0 !important;
      margin-bottom: 0 !important;
      max-height: 40px;
      overflow: hidden;
      display: flex;
    }
    notesgraph-paragraph .quote {
      padding-top: 4px;
      padding-bottom: 4px;
      height: 28px;
    }
    notesgraph-paragraph .quote::after {
      height: 20px;
      margin-top: 4px !important;
      margin-bottom: 4px !important;
    }
  }
`;
