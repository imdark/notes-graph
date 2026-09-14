import { scrollbarStyle } from '@blocksuite/notesgraph-shared/styles';
import { unsafeCSSVarV2 } from '@blocksuite/notesgraph-shared/theme';
import { css } from 'lit';

export const codeBlockStyles = css`
  notesgraph-code {
    display: block;
  }

  .notesgraph-code-block-container {
    font-size: var(--notesgraph-font-xs);
    line-height: var(--notesgraph-line-height);
    position: relative;
    padding: 32px 20px;
    background: var(--notesgraph-background-code-block);
    border-radius: 10px;
    box-sizing: border-box;
  }

  .notesgraph-code-block-container.mobile {
    padding: 12px;
  }

  .notesgraph-code-block-container.highlight-comment {
    outline: 2px solid ${unsafeCSSVarV2('block/comment/highlightUnderline')};
  }

  ${scrollbarStyle('.notesgraph-code-block-container rich-text')}

  /* In Chromium 121+, non-auto scrollbar-width/color override ::-webkit-scrollbar styles. */
  @supports not selector(::-webkit-scrollbar) {
    .notesgraph-code-block-container rich-text {
      scrollbar-width: thin;
      scrollbar-color: ${unsafeCSSVarV2('icon/secondary', '#b1b1b1')}
        transparent;
      scrollbar-gutter: stable both-edges;
    }
  }

  .notesgraph-code-block-container .inline-editor {
    font-family: var(--notesgraph-font-code-family);
    font-variant-ligatures: none;
  }

  .notesgraph-code-block-container v-line {
    position: relative;
    display: inline-grid !important;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .notesgraph-code-block-container.disable-line-numbers v-line {
    grid-template-columns: unset;
  }

  .notesgraph-code-block-container div:has(> v-line) {
    display: grid;
  }

  .notesgraph-code-block-container .line-number {
    position: sticky;
    text-align: left;
    padding-right: 12px;
    width: 32px;
    word-break: break-word;
    white-space: nowrap;
    left: -0.5px;
    z-index: 1;
    background: var(--notesgraph-background-code-block);
    font-size: var(--notesgraph-font-xs);
    line-height: var(--notesgraph-line-height);
    color: var(--notesgraph-text-secondary);
    box-sizing: border-box;
    user-select: none;
  }

  .notesgraph-code-block-container.disable-line-numbers .line-number {
    display: none;
  }

  notesgraph-code .notesgraph-code-block-preview {
    padding: 12px;
  }

  /* ── Collapsed state ──────────────────────────────────────────────── */

  /* Clamp the rich-text to the first 8 lines */
  .notesgraph-code-block-container.collapsed rich-text {
    display: block;
    max-height: calc(8 * var(--notesgraph-line-height));
    overflow: hidden;
  }

  /* Reduce bottom padding so the fade sits flush with the border */
  .notesgraph-code-block-container.collapsed {
    padding-bottom: 0;
  }

  /* Gradient overlay that fades to the block background */
  .notesgraph-code-block-container .code-collapsed-fade {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 80px;
    background: linear-gradient(
      to bottom,
      transparent,
      var(--notesgraph-background-code-block)
    );
    border-radius: 0 0 10px 10px;
    pointer-events: none;
    z-index: 1;
  }
`;
