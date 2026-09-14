import { unsafeCSSVarV2 } from '@blocksuite/notesgraph-shared/theme';
import { css } from 'lit';

export const styles = css`
  .notesgraph-attachment-container {
    border-radius: 8px;
    box-sizing: border-box;
    user-select: none;
    overflow: hidden;
    border: 1px solid ${unsafeCSSVarV2('layer/background/tertiary')};
    background: ${unsafeCSSVarV2('layer/background/primary')};

    &.focused {
      border-color: ${unsafeCSSVarV2('layer/insideBorder/primaryBorder')};
    }
  }

  .notesgraph-attachment-container.comment-highlighted {
    outline: 2px solid ${unsafeCSSVarV2('block/comment/highlightUnderline')};
  }

  .notesgraph-attachment-card {
    display: flex;
    gap: 12px;
    padding: 12px;
  }

  .notesgraph-attachment-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    flex: 1 0 0;
    min-width: 0;
  }

  .truncate {
    align-self: stretch;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }

  .notesgraph-attachment-content-title {
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
    align-self: stretch;
  }

  .notesgraph-attachment-content-title-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--notesgraph-text-primary-color);
    font-size: 16px;
  }

  .notesgraph-attachment-content-title-text {
    color: var(--notesgraph-text-primary-color);
    font-family: var(--notesgraph-font-family);
    font-size: var(--notesgraph-font-sm);
    font-style: normal;
    font-weight: 600;
    line-height: 22px;
  }

  .notesgraph-attachment-content-description {
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 8px;
  }

  .notesgraph-attachment-content-info {
    color: var(--notesgraph-text-secondary-color);
    font-family: var(--notesgraph-font-family);
    font-size: var(--notesgraph-font-xs);
    font-style: normal;
    font-weight: 400;
    line-height: 20px;
  }

  .notesgraph-attachment-content-button {
    display: flex;
    height: 20px;
    align-items: center;
    align-self: stretch;
    gap: 4px;
    white-space: nowrap;
    padding: 0 4px;
    color: ${unsafeCSSVarV2('button/primary')};
    font-family: var(--notesgraph-font-family);
    font-size: var(--notesgraph-font-xs);
    font-style: normal;
    font-weight: 500;
    text-transform: capitalize;
    line-height: 20px;

    svg {
      font-size: 16px;
    }
  }

  .notesgraph-attachment-banner {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .notesgraph-attachment-card.loading {
    .notesgraph-attachment-content-title-text {
      color: ${unsafeCSSVarV2('text/placeholder')};
    }
  }

  .notesgraph-attachment-card.error {
    .notesgraph-attachment-content-title-icon {
      color: ${unsafeCSSVarV2('status/error')};
    }
  }

  .notesgraph-attachment-card.loading,
  .notesgraph-attachment-card.error {
    background: ${unsafeCSSVarV2('layer/background/secondary')};
  }

  .notesgraph-attachment-card.cubeThick {
    flex-direction: column-reverse;

    .notesgraph-attachment-content {
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
      justify-content: space-between;
    }

    .notesgraph-attachment-banner {
      justify-content: space-between;
    }
  }

  .notesgraph-attachment-embed-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .notesgraph-attachment-embed-status {
    position: absolute;
    left: 14px;
    bottom: 64px;
  }

  .notesgraph-attachment-embed-event-mask {
    position: absolute;
    inset: 0;
  }
`;
