import { unsafeCSSVarV2 } from '@blocksuite/notesgraph-shared/theme';
import { baseTheme } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { css, unsafeCSS } from 'lit';

import {
  DEFAULT_ADD_BUTTON_WIDTH,
  DEFAULT_COLUMN_TITLE_HEIGHT,
} from '../../consts.js';

export const styles = css`
    notesgraph-database-column-header {
        display: block;
        background-color: var(--notesgraph-background-primary-color);
        position: relative;
        z-index: 2;
    }

    .notesgraph-database-column-header {
        position: relative;
        display: flex;
        flex-direction: row;
        border-bottom: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
        border-top: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
        box-sizing: border-box;
        user-select: none;
        background-color: var(--notesgraph-background-primary-color);
    }

    .notesgraph-database-column {
        cursor: pointer;
    }

    .database-cell {
        user-select: none;
    }

    .database-cell.add-column-button {
        flex: 1;
        min-width: ${DEFAULT_ADD_BUTTON_WIDTH}px;
        min-height: 100%;
        display: flex;
        align-items: center;
    }

    .notesgraph-database-column-content {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        height: 100%;
        padding: 6px;
        box-sizing: border-box;
        position: relative;
    }

    .notesgraph-database-column-content:hover,
    .notesgraph-database-column-content.edit {
        background: var(--notesgraph-hover-color);
    }

    .notesgraph-database-column-content.edit .notesgraph-database-column-text-icon {
        opacity: 1;
    }

    .notesgraph-database-column-text {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        /* https://stackoverflow.com/a/36247448/15443637 */
        overflow: hidden;
        color: var(--notesgraph-text-secondary-color);
        font-size: 14px;
        position: relative;
    }

    .notesgraph-database-column-type-icon {
        display: flex;
        align-items: center;
        border-radius: 4px;
        padding: 2px;
        font-size: 18px;
        color: ${unsafeCSSVarV2('database/textSecondary')};
    }

    .notesgraph-database-column-text-content {
        flex: 1;
        display: flex;
        align-items: center;
        overflow: hidden;
    }

    .notesgraph-database-column-content:hover .notesgraph-database-column-text-icon {
        opacity: 1;
    }

    .notesgraph-database-column-text-input {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }

    .notesgraph-database-column-text-icon {
        display: flex;
        align-items: center;
        width: 16px;
        height: 16px;
        background: var(--notesgraph-white);
        border: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
        border-radius: 4px;
        opacity: 0;
    }

    .notesgraph-database-column-text-save-icon {
        display: flex;
        align-items: center;
        width: 16px;
        height: 16px;
        border: 1px solid transparent;
        border-radius: 4px;
        fill: var(--notesgraph-icon-color);
    }

    .notesgraph-database-column-text-save-icon:hover {
        background: var(--notesgraph-white);
        border-color: ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
    }

    .notesgraph-database-column-text-icon svg {
        fill: var(--notesgraph-icon-color);
    }

    .notesgraph-database-column-input {
        width: 100%;
        height: 24px;
        padding: 0;
        border: none;
        color: inherit;
        font-weight: 600;
        font-size: 14px;
        font-family: ${unsafeCSS(baseTheme.fontSansFamily)};
        background: transparent;
    }

    .notesgraph-database-column-input:focus {
        outline: none;
    }

    .notesgraph-database-column-move {
        display: flex;
        align-items: center;
    }

    .notesgraph-database-column-move svg {
        width: 10px;
        height: 14px;
        color: var(--notesgraph-black-10);
        cursor: grab;
        opacity: 0;
    }

    .notesgraph-database-column-content:hover svg {
        opacity: 1;
    }

    .notesgraph-database-add-column-button {
        position: sticky;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 38px;
        cursor: pointer;
    }

    .header-add-column-button {
        height: ${DEFAULT_COLUMN_TITLE_HEIGHT}px;
        background-color: var(--notesgraph-background-primary-color);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        cursor: pointer;
        font-size: 18px;
        color: ${unsafeCSSVarV2('icon/primary')};
    }

    @media print {
        .header-add-column-button {
            display: none;
        }
    }

    .notesgraph-database-column-type-menu-icon {
        border: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
        border-radius: 4px;
        padding: 5px;
        background-color: var(--notesgraph-background-secondary-color);
    }

    .notesgraph-database-column-type-menu-icon svg {
        color: var(--notesgraph-text-secondary-color);
        width: 20px;
        height: 20px;

    }

    .notesgraph-database-column-move-preview {
        position: fixed;
        z-index: 100;
        width: 100px;
        height: 100px;
        background: var(--notesgraph-text-emphasis-color);
    }

    .notesgraph-database-column-move {
        --color: var(--notesgraph-placeholder-color);
        --active: var(--notesgraph-black-10);
        --bw: 1px;
        --bw2: -1px;
        cursor: grab;
        background: none;
        border: none;
        border-radius: 0;
        position: absolute;
        inset: 0;
    }

    .notesgraph-database-column-move .control-l::before,
    .notesgraph-database-column-move .control-h::before,
    .notesgraph-database-column-move .control-l::after,
    .notesgraph-database-column-move .control-h::after,
    .notesgraph-database-column-move .control-r,
    .notesgraph-database-column-move .hover-trigger {
        --delay: 0s;
        --delay-opacity: 0s;
        content: '';
        position: absolute;
        transition: all 0.2s ease var(--delay),
        opacity 0.2s ease var(--delay-opacity);
    }

    .notesgraph-database-column-move .control-r {
        --delay: 0s;
        --delay-opacity: 0.6s;
        width: 4px;
        border-radius: 1px;
        height: 32%;
        background: var(--color);
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        opacity: 0;
        pointer-events: none;
    }

    .notesgraph-database-column-move .hover-trigger {
        width: 12px;
        height: 80%;
        right: 3px;
        top: 10%;
        background: transparent
        z-index: 1;
        opacity: 1;
    }

    .notesgraph-database-column-move:hover .control-r {
        opacity: 1;
    }

    .notesgraph-database-column-move .control-h::before,
    .notesgraph-database-column-move .control-h::after {
        --delay: 0.2s;
        width: calc(100% - var(--bw2) * 2);
        opacity: 0;
        height: var(--bw);
        right: var(--bw2);
        background: var(--active);
    }

    .notesgraph-database-column-move .control-h::before {
        top: var(--bw2);
    }

    .notesgraph-database-column-move .control-h::after {
        bottom: var(--bw2);
    }

    .notesgraph-database-column-move .control-l::before {
        --delay: 0s;
        width: var(--bw);
        height: 100%;
        opacity: 0;
        background: var(--active);
        left: var(--bw2);
    }

    .notesgraph-database-column-move .control-l::before {
        top: 0;
    }

    .notesgraph-database-column-move .control-l::after {
        bottom: 0;
    }

    /* handle--active style */

    .notesgraph-database-column-move:hover .control-r {
        --delay-opacity: 0s;
        opacity: 1;
    }

    .notesgraph-database-column-move:active .control-r,
    .hover-trigger:hover ~ .control-r,
    .grabbing.notesgraph-database-column-move .control-r {
        opacity: 1;
        --delay: 0s;
        --delay-opacity: 0s;
        right: var(--bw2);
        width: var(--bw);
        height: 100%;
        background: var(--active);
    }

    .notesgraph-database-column-move:active .control-h::before,
    .notesgraph-database-column-move:active .control-h::after,
    .hover-trigger:hover ~ .control-h::before,
    .hover-trigger:hover ~ .control-h::after,
    .grabbing.notesgraph-database-column-move .control-h::before,
    .grabbing.notesgraph-database-column-move .control-h::after {
        --delay: 0.2s;
        width: calc(100% - var(--bw2) * 2);
        opacity: 1;
    }

    .notesgraph-database-column-move:active .control-l::before,
    .notesgraph-database-column-move:active .control-l::after,
    .hover-trigger:hover ~ .control-l::before,
    .hover-trigger:hover ~ .control-l::after,
    .grabbing.notesgraph-database-column-move .control-l::before,
    .grabbing.notesgraph-database-column-move .control-l::after {
        --delay: 0.4s;
        opacity: 1;
    }
`;
