import {
  fontXSStyle,
  panelBaseStyle,
} from '@blocksuite/notesgraph-shared/styles';
import { css } from 'lit';

export const renameStyles = css`
  ${panelBaseStyle('.notesgraph-attachment-rename-container')}
  .notesgraph-attachment-rename-container {
    position: relative;
    display: flex;
    align-items: center;
    width: 320px;
    gap: 12px;
    padding: 12px;
    z-index: var(--notesgraph-z-index-popover);
  }

  .notesgraph-attachment-rename-input-wrapper {
    display: flex;
    min-width: 280px;
    height: 30px;
    box-sizing: border-box;
    padding: 4px 10px;
    background: var(--notesgraph-white-10);
    border-radius: 4px;
    border: 1px solid var(--notesgraph-border-color);
  }

  .notesgraph-attachment-rename-input-wrapper:focus-within {
    border-color: var(--notesgraph-blue-700);
    box-shadow: var(--notesgraph-active-shadow);
  }

  .notesgraph-attachment-rename-input-wrapper input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--notesgraph-text-primary-color);
  }
  ${fontXSStyle('.notesgraph-attachment-rename-input-wrapper input')}

  .notesgraph-attachment-rename-input-wrapper input::placeholder {
    color: var(--notesgraph-placeholder-color);
  }

  .notesgraph-attachment-rename-extension {
    font-size: var(--notesgraph-font-xs);
    color: var(--notesgraph-text-secondary-color);
  }

  .notesgraph-attachment-rename-overlay-mask {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: var(--notesgraph-z-index-popover);
  }
`;

export const styles = css`
  :host {
    z-index: 1;
  }
`;
