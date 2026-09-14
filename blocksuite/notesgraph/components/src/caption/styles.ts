import { css } from 'lit';

export const styles = css`
  .notesgraph-block-component.border.light .selected-style {
    border-radius: 8px;
    box-shadow: 0px 0px 0px 1px var(--notesgraph-brand-color);
  }
  .notesgraph-block-component.border.dark .selected-style {
    border-radius: 8px;
    box-shadow: 0px 0px 0px 1px var(--notesgraph-brand-color);
  }
  @media print {
    .notesgraph-block-component.border.light .selected-style,
    .notesgraph-block-component.border.dark .selected-style {
      box-shadow: none;
    }
  }
`;
