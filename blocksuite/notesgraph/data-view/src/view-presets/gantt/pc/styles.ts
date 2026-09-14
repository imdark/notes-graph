import { css } from 'lit';

export const ganttViewStyles = css`
  notesgraph-data-view-gantt {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    --gantt-row-height: 36px;
    --gantt-header-height: 44px;
    --gantt-name-width: 200px;
    --gantt-bar-height: 22px;
    --gantt-milestone-size: 16px;
    --gantt-grid-color: color-mix(
      in srgb,
      var(--notesgraph-border-color) 55%,
      transparent
    );
    --gantt-bar-bg: color-mix(
      in srgb,
      var(--notesgraph-primary-color) 16%,
      var(--notesgraph-background-primary-color)
    );
    --gantt-bar-border: color-mix(
      in srgb,
      var(--notesgraph-primary-color) 45%,
      transparent
    );
    --gantt-offday-bg: color-mix(
      in srgb,
      var(--notesgraph-text-primary-color) 7%,
      transparent
    );
  }

  .gantt-offday {
    position: absolute;
    z-index: 0;
    background: var(--gantt-offday-bg);
    pointer-events: none;
  }

  .gantt-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 320px;
  }

  .gantt-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
  }

  .gantt-spacer {
    flex: 1;
  }

  .gantt-zoom-group {
    display: inline-flex;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 6px;
    overflow: hidden;
  }

  .gantt-zoom-button {
    border: none;
    background: transparent;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--notesgraph-text-secondary-color);
  }

  .gantt-zoom-button.active {
    background: var(--notesgraph-hover-color);
    color: var(--notesgraph-text-primary-color);
  }

  .gantt-tool-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 6px;
    background: transparent;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--notesgraph-text-primary-color);
  }

  .gantt-tool-button:hover {
    background: var(--notesgraph-hover-color);
  }

  .gantt-tool-button.active {
    background: var(--notesgraph-hover-color);
  }

  .gantt-tool-button.primary {
    background: var(--notesgraph-primary-color);
    border-color: var(--notesgraph-primary-color);
    color: var(--notesgraph-pure-white, #fff);
  }

  .gantt-tool-button svg {
    width: 16px;
    height: 16px;
  }

  .gantt-import {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 4px 12px;
  }

  .gantt-import-text {
    width: 100%;
    min-height: 160px;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 8px;
    background: var(--notesgraph-background-primary-color);
    color: var(--notesgraph-text-primary-color);
    font-family: var(--notesgraph-font-code-family, monospace);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }

  .gantt-import-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .gantt-import-hint {
    flex: 1;
    font-size: 12px;
    color: var(--notesgraph-text-secondary-color);
  }

  .gantt-scroll {
    position: relative;
    flex: 1;
    overflow: auto;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 8px;
    max-height: 640px;
  }

  .gantt-inner {
    position: relative;
    box-sizing: border-box;
  }

  .gantt-header {
    position: sticky;
    top: 0;
    z-index: 6;
    display: flex;
    height: var(--gantt-header-height);
    background: var(--notesgraph-background-primary-color);
    border-bottom: 1px solid var(--gantt-grid-color);
  }

  .gantt-corner {
    position: sticky;
    left: 0;
    z-index: 7;
    width: var(--gantt-name-width);
    flex: 0 0 var(--gantt-name-width);
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--notesgraph-text-secondary-color);
    background: var(--notesgraph-background-primary-color);
    border-right: 1px solid var(--gantt-grid-color);
  }

  .gantt-ticks {
    position: relative;
    height: 100%;
  }

  .gantt-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-left: 4px;
    font-size: 11px;
    white-space: nowrap;
    color: var(--notesgraph-text-secondary-color);
    border-left: 1px solid var(--gantt-grid-color);
  }

  .gantt-tick.major {
    color: var(--notesgraph-text-primary-color);
    font-weight: 600;
  }

  .gantt-grid {
    position: absolute;
    z-index: 0;
    background-repeat: repeat;
  }

  .gantt-today-line {
    position: absolute;
    z-index: 1;
    width: 0;
    border-left: 1px dashed var(--notesgraph-primary-color);
    pointer-events: none;
  }

  .gantt-rows {
    position: relative;
  }

  .gantt-row {
    display: flex;
    height: var(--gantt-row-height);
    box-sizing: border-box;
    border-bottom: 1px solid var(--gantt-grid-color);
  }

  .gantt-row-name {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--gantt-name-width);
    flex: 0 0 var(--gantt-name-width);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    box-sizing: border-box;
    font-size: 13px;
    cursor: grab;
    user-select: none;
    background: var(--notesgraph-background-primary-color);
    border-right: 1px solid var(--gantt-grid-color);
    overflow: hidden;
  }

  .gantt-row-name:hover {
    background: var(--notesgraph-hover-color);
  }

  .gantt-row-name:active {
    cursor: grabbing;
  }

  /* Notion-style "+" centered on the boundary between two rows. */
  .gantt-row-insert {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 18px;
    height: 18px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--notesgraph-primary-color);
    background: var(--notesgraph-background-primary-color);
    color: var(--notesgraph-primary-color);
    cursor: pointer;
    z-index: 10;
    box-shadow: 0 0 0 2px var(--notesgraph-background-primary-color);
  }

  /* A faint guide line across the name column at the boundary. */
  .gantt-row-insert::before {
    content: '';
    position: absolute;
    z-index: -1;
    left: 50%;
    width: var(--gantt-name-width);
    height: 2px;
    transform: translateX(-50%);
    background: var(--notesgraph-primary-color);
    opacity: 0.35;
  }

  .gantt-row-insert.top {
    top: -9px;
  }

  .gantt-row-insert.bottom {
    bottom: -9px;
  }

  .gantt-row-insert:hover {
    background: var(--notesgraph-primary-color);
    color: var(--notesgraph-pure-white, #fff);
  }

  .gantt-row-insert svg {
    width: 12px;
    height: 12px;
  }

  .gantt-row.reordering {
    opacity: 0.5;
  }

  .gantt-drop-line {
    position: absolute;
    left: 0;
    z-index: 8;
    height: 0;
    border-top: 2px solid var(--notesgraph-primary-color);
    pointer-events: none;
  }

  .gantt-row-name-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The active row shows the insert "+" overflowing onto a row boundary. */
  .gantt-row-name.insert-active {
    overflow: visible;
    z-index: 9;
  }

  .gantt-row-name-text.is-empty {
    color: var(--notesgraph-text-secondary-color);
  }

  .gantt-row-name.is-container .gantt-row-name-text {
    font-weight: 600;
  }

  .gantt-row-track {
    position: relative;
    height: 100%;
  }

  .gantt-bar {
    position: absolute;
    z-index: 2;
    top: calc((var(--gantt-row-height) - var(--gantt-bar-height)) / 2);
    height: var(--gantt-bar-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-radius: 5px;
    background: var(--gantt-bar-bg);
    border: 1px solid var(--gantt-bar-border);
    color: var(--notesgraph-text-primary-color);
    font-size: 12px;
    cursor: grab;
    user-select: none;
  }

  .gantt-bar.dragging {
    cursor: grabbing;
    opacity: 0.85;
  }

  .gantt-bar-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .gantt-bar-handle {
    position: absolute;
    top: 0;
    width: 8px;
    height: 100%;
    cursor: ew-resize;
    z-index: 1;
  }

  .gantt-bar-handle.left {
    left: 0;
  }

  .gantt-bar-handle.right {
    right: 0;
  }

  /* Sits fully outside the bar's right edge so it never overlaps the resize
     handle (which would otherwise swallow end-drag pointer events). */
  .gantt-bar-connector {
    position: absolute;
    right: -16px;
    top: 50%;
    transform: translateY(-50%);
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--notesgraph-background-primary-color);
    border: 1px solid var(--notesgraph-primary-color);
    cursor: crosshair;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .gantt-bar:hover .gantt-bar-connector,
  .gantt-bar-connector:hover {
    opacity: 1;
  }

  /* Milestone: a diamond marker centred on its day, with a trailing label. */
  .gantt-milestone {
    position: absolute;
    z-index: 2;
    top: calc(
      (var(--gantt-row-height) - var(--gantt-milestone-size, 16px)) / 2
    );
    height: var(--gantt-milestone-size, 16px);
    display: flex;
    align-items: center;
    cursor: grab;
    user-select: none;
  }

  .gantt-milestone.dragging {
    cursor: grabbing;
    opacity: 0.85;
  }

  .gantt-milestone-marker {
    flex: 0 0 var(--gantt-milestone-size, 16px);
    width: var(--gantt-milestone-size, 16px);
    height: var(--gantt-milestone-size, 16px);
    box-sizing: border-box;
    transform: rotate(45deg);
    border-radius: 3px;
    background: var(--gantt-milestone-color, var(--notesgraph-primary-color));
    border: 1px solid
      color-mix(
        in srgb,
        var(--gantt-milestone-color, var(--notesgraph-primary-color)) 70%,
        var(--notesgraph-text-primary-color)
      );
  }

  .gantt-milestone-label {
    margin-left: 8px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--notesgraph-text-primary-color);
    pointer-events: none;
  }

  .gantt-milestone-connector {
    position: absolute;
    left: calc(var(--gantt-milestone-size, 16px) + 2px);
    top: 50%;
    transform: translateY(-50%);
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--notesgraph-background-primary-color);
    border: 1px solid var(--notesgraph-primary-color);
    cursor: crosshair;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .gantt-milestone:hover .gantt-milestone-connector,
  .gantt-milestone-connector:hover {
    opacity: 1;
  }

  .gantt-row-track.schedulable {
    cursor: copy;
  }

  .gantt-ghost-bar {
    position: absolute;
    z-index: 2;
    top: calc((var(--gantt-row-height) - var(--gantt-bar-height)) / 2);
    height: var(--gantt-bar-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    border: 1px dashed var(--gantt-bar-border);
    background: color-mix(
      in srgb,
      var(--notesgraph-primary-color) 8%,
      transparent
    );
    color: var(--notesgraph-text-secondary-color);
    pointer-events: none;
  }

  .gantt-ghost-bar svg {
    width: 16px;
    height: 16px;
  }

  .gantt-deps {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    overflow: visible;
  }

  .gantt-dep-hit {
    stroke: transparent;
    stroke-width: 10;
    fill: none;
    pointer-events: stroke;
    cursor: pointer;
  }

  .gantt-dep-line {
    stroke: var(--notesgraph-text-secondary-color);
    stroke-width: 1.5;
    fill: none;
  }

  .gantt-dep-arrow {
    fill: var(--notesgraph-text-secondary-color);
  }

  .gantt-dep-temp {
    stroke: var(--notesgraph-primary-color);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
    fill: none;
  }

  .gantt-empty {
    padding: 24px 16px;
    color: var(--notesgraph-text-secondary-color);
    font-size: 13px;
  }

  .gantt-setup {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
  }

  .gantt-setup button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 8px;
    background: var(--notesgraph-background-primary-color);
    cursor: pointer;
    font-size: 14px;
    color: var(--notesgraph-text-primary-color);
  }

  .gantt-setup button:hover {
    background: var(--notesgraph-hover-color);
  }
`;
