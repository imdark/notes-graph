import { css } from 'lit';

export const embedIframeBlockStyles = css`
  .notesgraph-embed-iframe-block-container {
    display: flex;
    width: 100%;
    border-radius: 8px;
    user-select: none;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .notesgraph-embed-iframe-block-container.in-surface {
    height: 100%;
  }

  .notesgraph-embed-iframe-block-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: none;
  }

  .notesgraph-embed-iframe-frame {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  /* small title banner on top of the embed */
  .notesgraph-embed-iframe-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: var(--notesgraph-text-primary-color);
    background: var(--notesgraph-background-secondary-color);
    border-bottom: 0.5px solid var(--notesgraph-border-color);
    border-radius: 8px 8px 0 0;
  }

  .notesgraph-embed-iframe-favicon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    object-fit: cover;
  }

  .notesgraph-embed-iframe-title-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notesgraph-embed-iframe-source {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    border-radius: 4px;
    font-size: 12px;
    line-height: 16px;
    pointer-events: none;
  }
  .notesgraph-embed-iframe-block-overlay.show {
    display: block;
  }
`;
