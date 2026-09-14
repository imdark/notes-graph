import {
  fontSMStyle,
  panelBaseStyle,
} from '@blocksuite/notesgraph-shared/styles';
import { css } from 'lit';

const editLinkStyle = css`
  .notesgraph-link-edit-popover {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: repeat(2, 1fr);
    grid-template-areas:
      'text-area .'
      'link-area btn';
    justify-items: center;
    align-items: center;
    width: 320px;
    gap: 8px 12px;
    padding: 8px;
    box-sizing: content-box;
  }

  ${fontSMStyle('.notesgraph-link-edit-popover label')}
  .notesgraph-link-edit-popover label {
    box-sizing: border-box;
    color: var(--notesgraph-icon-color);
    font-weight: 400;
  }

  ${fontSMStyle('.notesgraph-link-edit-popover input')}
  .notesgraph-link-edit-popover input {
    color: inherit;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--notesgraph-text-primary-color);
  }
  .notesgraph-link-edit-popover input::placeholder {
    color: var(--notesgraph-placeholder-color);
  }
  input:focus {
    outline: none;
  }
  .notesgraph-link-edit-popover input:focus ~ label,
  .notesgraph-link-edit-popover input:active ~ label {
    color: var(--notesgraph-primary-color);
  }

  .notesgraph-edit-area {
    width: 280px;
    padding: 4px 10px;
    display: grid;
    gap: 8px;
    grid-template-columns: 26px auto;
    grid-template-rows: repeat(1, 1fr);
    grid-template-areas: 'label input';
    user-select: none;
    box-sizing: border-box;

    border: 1px solid var(--notesgraph-border-color);
    box-sizing: border-box;

    outline: none;
    border-radius: 4px;
    background: transparent;
  }
  .notesgraph-edit-area:focus-within {
    border-color: var(--notesgraph-blue-700);
    box-shadow: var(--notesgraph-active-shadow);
  }

  .notesgraph-edit-area.text {
    grid-area: text-area;
  }

  .notesgraph-edit-area.link {
    grid-area: link-area;
  }

  .notesgraph-edit-label {
    grid-area: label;
  }

  .notesgraph-edit-input {
    grid-area: input;
  }

  .notesgraph-confirm-button {
    grid-area: btn;
    user-select: none;
  }
`;

export const linkPopupStyle = css`
  :host {
    box-sizing: border-box;
  }

  .mock-selection {
    position: absolute;
    background-color: rgba(35, 131, 226, 0.28);
  }

  ${panelBaseStyle('.popover-container')}
  .popover-container {
    z-index: var(--notesgraph-z-index-popover);
    animation: notesgraph-popover-fade-in 0.2s ease;
    position: absolute;
  }

  @keyframes notesgraph-popover-fade-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .overlay-root {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: var(--notesgraph-z-index-popover);
  }

  .mock-selection-container {
    pointer-events: none;
  }

  .notesgraph-link-popover.create {
    display: flex;
    gap: 12px;
    padding: 8px;

    color: var(--notesgraph-text-primary-color);
  }

  .notesgraph-link-popover-input {
    min-width: 280px;
    height: 30px;
    box-sizing: border-box;
    padding: 4px 10px;
    background: var(--notesgraph-white-10);
    border-radius: 4px;
    border-width: 1px;
    border-style: solid;
    border-color: var(--notesgraph-border-color);
    color: var(--notesgraph-text-primary-color);
  }
  ${fontSMStyle('.notesgraph-link-popover-input')}
  .notesgraph-link-popover-input::placeholder {
    color: var(--notesgraph-placeholder-color);
  }
  .notesgraph-link-popover-input:focus {
    border-color: var(--notesgraph-blue-700);
    box-shadow: var(--notesgraph-active-shadow);
  }

  ${editLinkStyle}
`;
