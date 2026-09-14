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
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
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
  }

  .dv-list-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
