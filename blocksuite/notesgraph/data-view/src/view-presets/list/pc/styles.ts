import { css } from 'lit';

export const listViewStyles = css`
  notesgraph-data-view-list {
    display: block;
  }

  .dv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0;
  }

  .dv-list-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: var(--notesgraph-font-sm);
    color: var(--notesgraph-text-primary-color);
  }

  .dv-list-row:hover {
    background: var(--notesgraph-hover-color);
  }

  .dv-list-checkbox {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1.5px solid var(--notesgraph-text-secondary-color);
    flex-shrink: 0;
    /* Nudge onto the title's baseline now the row aligns to the top. */
    margin-top: 2px;
  }

  /* Title + breadcrumb stack. align-items on the row is center, so this keeps
     the checkbox aligned to the title rather than to the pair's midpoint. */
  .dv-list-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .dv-list-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Where the task lives: project › note › parent task. Secondary and small -
     it is orientation, not content, and must not make rows twice as tall. */
  .dv-list-breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--notesgraph-font-xs);
    line-height: 1.3;
    color: var(--notesgraph-text-secondary-color);
  }

  .dv-list-crumb {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The last segment is the most specific, so let it keep its width and
     squeeze the outer ones first. */
  .dv-list-crumb:last-child {
    flex-shrink: 0;
    max-width: 60%;
  }

  .dv-list-crumb-sep {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .dv-list-empty {
    padding: 8px;
    font-size: var(--notesgraph-font-sm);
    color: var(--notesgraph-text-secondary-color);
  }

  .dv-list-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    font-size: var(--notesgraph-font-sm);
    color: var(--notesgraph-text-secondary-color);
  }

  /* Trailing hint while rows are still arriving under already-rendered ones. */
  .dv-list-loading-more {
    padding: 4px 8px 2px;
  }

  .dv-list-spinner {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 1.5px solid var(--notesgraph-border-color);
    border-top-color: var(--notesgraph-text-secondary-color);
    animation: dv-list-spin 0.7s linear infinite;
  }

  @keyframes dv-list-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dv-list-spinner {
      animation-duration: 2.4s;
    }
  }

  .dv-list-pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 2px;
    margin-top: 2px;
    border-top: 1px solid var(--notesgraph-border-color);
    font-size: var(--notesgraph-font-xs);
    color: var(--notesgraph-text-secondary-color);
  }

  .dv-list-page-size {
    appearance: none;
    background: transparent;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: var(--notesgraph-font-xs);
    color: var(--notesgraph-text-secondary-color);
    cursor: pointer;
  }

  .dv-list-pager-nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dv-list-page-info {
    min-width: 40px;
    text-align: center;
  }

  .dv-list-page-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 4px;
    background: transparent;
    color: var(--notesgraph-text-primary-color);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .dv-list-page-btn:hover:not(:disabled) {
    background: var(--notesgraph-hover-color);
  }

  .dv-list-page-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;
