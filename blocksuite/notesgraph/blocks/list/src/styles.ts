import { css } from 'lit';

export const listPrefix = css`
  .notesgraph-list-block__prefix {
    display: flex;
    color: var(--notesgraph-blue-700);
    font-size: var(--notesgraph-font-sm);
    user-select: none;
    position: relative;
  }

  .notesgraph-list-block__numbered {
    min-width: 22px;
    height: 24px;
    margin-left: 2px;
  }

  .notesgraph-list-block__todo-prefix {
    display: flex;
    align-items: center;
    cursor: pointer;
    width: 24px;
    height: 24px;
    color: var(--notesgraph-icon-color);
  }

  .notesgraph-list-block__todo-prefix.readonly {
    cursor: default;
  }

  .notesgraph-list-block__todo-prefix > svg {
    width: 20px;
    height: 20px;
  }

  /* Outline-zoom handle for todo items: a small bullet revealed on hover
     to the left of the checkbox, in the same off-row gutter as the
     children-collapse toggle. */
  .notesgraph-list-block__zoom-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    width: 16px;
    height: 24px;
    left: 0;
    transform: translateX(-100%);
    /* The drag-handle widget's host element hit-tests over the block
       gutter; paint order decides, so sit above it. */
    z-index: 1;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
    color: var(--notesgraph-icon-secondary, var(--notesgraph-icon-color));
    user-select: none;
  }
  .notesgraph-list-block__zoom-handle > svg {
    width: 14px;
    height: 14px;
  }
  .notesgraph-list-rich-text-wrapper:hover
    > .notesgraph-list-block__zoom-handle {
    opacity: 1;
  }
  .notesgraph-list-block__zoom-handle:hover {
    background: var(--notesgraph-hover-color);
  }
  /* When the collapse toggle occupies the first gutter slot, sit one slot
     further left. */
  .notesgraph-list-rich-text-wrapper:has(blocksuite-toggle-button)
    > .notesgraph-list-block__zoom-handle {
    transform: translateX(-200%);
  }
`;

export const listBlockStyles = css`
  notesgraph-list {
    display: block;
    font-size: var(--notesgraph-font-base);
  }

  notesgraph-list code {
    font-size: calc(var(--notesgraph-font-base) - 3px);
    padding: 0px 4px 2px;
  }

  .notesgraph-list-block-container {
    box-sizing: border-box;
    border-radius: 4px;
    position: relative;
  }
  .notesgraph-list-block-container .notesgraph-list-block-container {
    margin-top: 0;
  }
  .notesgraph-list-rich-text-wrapper {
    position: relative;
    display: flex;
  }
  .notesgraph-list-rich-text-wrapper rich-text {
    flex: 1;
  }

  .notesgraph-list--checked {
    color: var(--notesgraph-text-secondary-color);
  }

  ${listPrefix}
`;
