import {
  unsafeCSSVar,
  unsafeCSSVarV2,
} from '@blocksuite/notesgraph-shared/theme';
import { baseTheme } from '@toeverything/theme';
import { css, unsafeCSS } from 'lit';

export const styles = css`
  bookmark-card {
    display: block;
    height: 100%;
    width: 100%;
  }

  .notesgraph-bookmark-card {
    container: notesgraph-bookmark-card / inline-size;
    margin: 0 auto;
    box-sizing: border-box;
    display: flex;
    width: 100%;

    border-radius: 8px;
    border: 1px solid ${unsafeCSSVarV2('layer/background/tertiary')};

    background: ${unsafeCSSVarV2('layer/background/primary')};
    user-select: none;
  }

  .notesgraph-bookmark-content {
    width: calc(100% - 204px);
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    align-self: stretch;
    gap: 4px;
    padding: 12px;
  }

  .notesgraph-bookmark-content-title {
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;

    align-self: stretch;
  }

  .notesgraph-bookmark-content-title-icon {
    display: flex;
    width: 16px;
    height: 16px;
    justify-content: center;
    align-items: center;
  }

  .notesgraph-bookmark-content-title-icon img,
  .notesgraph-bookmark-content-title-icon object,
  .notesgraph-bookmark-content-title-icon svg {
    width: 16px;
    height: 16px;
    fill: var(--notesgraph-background-primary-color);
  }

  .notesgraph-bookmark-content-title-text {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;

    word-break: break-word;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--notesgraph-text-primary-color);

    font-family: var(--notesgraph-font-family);
    font-size: var(--notesgraph-font-sm);
    font-style: normal;
    font-weight: 600;
    line-height: 22px;
  }

  .notesgraph-bookmark-content-description {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;

    flex-grow: 1;

    white-space: normal;
    word-break: break-word;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--notesgraph-text-primary-color);

    font-family: var(--notesgraph-font-family);
    font-size: var(--notesgraph-font-xs);
    font-style: normal;
    font-weight: 400;
    line-height: 20px;
  }

  .notesgraph-bookmark-content-url {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    width: max-content;
    max-width: 100%;
  }

  .notesgraph-bookmark-content-url > span {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;

    word-break: break-all;
    white-space: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--notesgraph-text-secondary-color);

    font-family: ${unsafeCSS(baseTheme.fontSansFamily)};
    font-size: var(--notesgraph-font-xs);
    font-style: normal;
    font-weight: 400;
    line-height: 20px;
  }
  .notesgraph-bookmark-content-url:hover > span {
    color: var(--notesgraph-link-color);
  }
  .notesgraph-bookmark-content-url:hover {
    fill: var(--notesgraph-link-color);
  }

  .notesgraph-bookmark-content-url-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 20px;
  }
  .notesgraph-bookmark-content-url-icon {
    height: 12px;
    width: 12px;
    color: ${unsafeCSSVar('iconSecondary')};
  }

  .notesgraph-bookmark-banner {
    margin: 12px 12px 0px 0px;
    width: 204px;
    max-width: 100%;
    height: 102px;
  }

  .notesgraph-bookmark-banner img,
  .notesgraph-bookmark-banner object,
  .notesgraph-bookmark-banner svg {
    width: 204px;
    max-width: 100%;
    height: 102px;
    object-fit: cover;
    border-radius: 4px;
  }

  .notesgraph-bookmark-card.comment-highlighted {
    outline: 2px solid ${unsafeCSSVarV2('block/comment/highlightUnderline')};
  }

  .notesgraph-bookmark-card.loading {
    .notesgraph-bookmark-content-title-text {
      color: var(--notesgraph-placeholder-color);
    }
  }

  .notesgraph-bookmark-card.error {
    .notesgraph-bookmark-content-description {
      color: var(--notesgraph-placeholder-color);
    }
  }

  .notesgraph-bookmark-card.selected {
    .notesgraph-bookmark-content-url > span {
      color: var(--notesgraph-link-color);
    }
    .notesgraph-bookmark-content-url .notesgraph-bookmark-content-url-icon {
      color: var(--notesgraph-link-color);
    }
  }

  .notesgraph-bookmark-card.list {
    .notesgraph-bookmark-content {
      width: 100%;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .notesgraph-bookmark-content-title {
      width: calc(100% - 204px);
    }

    .notesgraph-bookmark-content-url {
      width: 204px;
      justify-content: flex-end;
    }

    .notesgraph-bookmark-content-description {
      display: none;
    }

    .notesgraph-bookmark-banner {
      display: none;
    }
  }

  .notesgraph-bookmark-card.vertical {
    flex-direction: column-reverse;
    height: 100%;

    .notesgraph-bookmark-content {
      width: 100%;
    }

    .notesgraph-bookmark-content-description {
      -webkit-line-clamp: 6;
      max-height: 120px;
    }

    .notesgraph-bookmark-content-url-wrapper {
      max-width: fit-content;
      display: flex;
      align-items: flex-end;
      flex-grow: 1;
      cursor: pointer;
    }

    .notesgraph-bookmark-banner {
      width: 100%;
      /* Match the link-card's fixed 1200x630 size so the whole card shows;
         screenshots are cropped to the same ratio, anchored to the top. */
      aspect-ratio: 1200 / 630;
      height: auto;
      margin: 0 0 12px 0;
    }

    .notesgraph-bookmark-banner img,
    .notesgraph-bookmark-banner object,
    .notesgraph-bookmark-banner svg {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
    }
  }

  .notesgraph-bookmark-card.cube {
    .notesgraph-bookmark-content {
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
      justify-content: space-between;
    }

    .notesgraph-bookmark-content-title {
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
    }

    .notesgraph-bookmark-content-title-text {
      -webkit-line-clamp: 2;
    }

    .notesgraph-bookmark-content-description {
      display: none;
    }

    .notesgraph-bookmark-banner {
      display: none;
    }
  }

  @container notesgraph-bookmark-card (width < 375px) {
    .notesgraph-bookmark-content {
      width: 100%;
    }
    .notesgraph-bookmark-card:not(.edgeless) .notesgraph-bookmark-banner {
      display: none;
    }
  }
`;
