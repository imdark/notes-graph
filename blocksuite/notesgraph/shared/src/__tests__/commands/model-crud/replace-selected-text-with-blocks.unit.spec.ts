/**
 * @vitest-environment happy-dom
 */
import type { TextSelection } from '@blocksuite/std';
import { describe, expect, it } from 'vitest';

import { replaceSelectedTextWithBlocksCommand } from '../../../commands/model-crud/replace-selected-text-with-blocks';
import { block, notesgraph } from '../../../test-utils';

describe('commands/model-crud', () => {
  describe('replaceSelectedTextWithBlocksCommand', () => {
    it('should replace selected text with blocks when both first and last blocks are mergable blocks', () => {
      const host = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph id="111">111</notesgraph-paragraph>`,
        block`<notesgraph-code id="code"></notesgraph-code>`,
        block`<notesgraph-paragraph id="222">222</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel111</notesgraph-paragraph>
            <notesgraph-code id="code"></notesgraph-code>
            <notesgraph-paragraph id="paragraph-2">222ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when both first and last blocks are mergable blocks in single paragraph', () => {
      const host = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel<anchor></anchor>lo Wor<focus></focus>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph id="111">111</notesgraph-paragraph>`,
        block`<notesgraph-code id="code"></notesgraph-code>`,
        block`<notesgraph-paragraph id="222">222</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel111</notesgraph-paragraph>
            <notesgraph-code id="code"></notesgraph-code>
            <notesgraph-paragraph id="222">222ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when blocks contains only one mergable block', () => {
      const host = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph id="111">111</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel111ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when blocks contains only one mergable block in single paragraph', () => {
      const host = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel<anchor></anchor>lo Wor<focus></focus>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph id="111">111</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page id="page">
          <notesgraph-note id="note">
            <notesgraph-paragraph id="paragraph-1">Hel111ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when only first block is mergable block', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph>Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-paragraph>Hel111</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when only first block is mergable block in single paragraph', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor></anchor>lo Wor<focus></focus>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel111</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when only last block is mergable block', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph>Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-paragraph>Hel</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>111ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when only last block is mergable block in single paragraph', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor></anchor>lo Wor<focus></focus>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>111ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when neither first nor last block is mergable block', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph>Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-paragraph>Hel</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when neither first nor last block is mergable block in single paragraph', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor></anchor>lo Wor<focus></focus>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-code></notesgraph-code>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel</notesgraph-paragraph>
            <notesgraph-code></notesgraph-code>
            <notesgraph-code></notesgraph-code>
            <notesgraph-paragraph>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when both first and last blocks are mergable blocks with different types', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-paragraph>Hel<anchor />lo</notesgraph-paragraph>
            <notesgraph-paragraph>Wor<focus />ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-list>1.</notesgraph-list>`,
        block`<notesgraph-list>2.</notesgraph-list>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-paragraph>Hel</notesgraph-paragraph>
            <notesgraph-list>1.</notesgraph-list>
            <notesgraph-list>2.</notesgraph-list>
            <notesgraph-paragraph>ld</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when both first and last blocks are paragraphs, and cursor is at the end of the text-block with different types', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-list>Hel<anchor />lo</notesgraph-list>
            <notesgraph-list>Wor<focus />ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
        block`<notesgraph-paragraph>222</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-list>Hel111</notesgraph-list>
            <notesgraph-list>222ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when first block is paragraph, and cursor is at the end of the text-block with different type  ', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-list>Hel<anchor />lo</notesgraph-list>
            <notesgraph-list>Wor<focus />ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-paragraph>111</notesgraph-paragraph>`,
        block`<notesgraph-code></notesgraph-code>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-list>Hel111</notesgraph-list>
            <notesgraph-code></notesgraph-code>
            <notesgraph-list>ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });

    it('should replace selected text with blocks when last block is paragraph, and cursor is at the end of the text-block with different type  ', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note>
            <notesgraph-list>Hel<anchor />lo</notesgraph-list>
            <notesgraph-list>Wor<focus />ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const blocks = [
        block`<notesgraph-code></notesgraph-code>`,
        block`<notesgraph-paragraph>222</notesgraph-paragraph>`,
      ]
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map(b => b.model);

      const textSelection = host.selection.value[0] as TextSelection;

      host.command.exec(replaceSelectedTextWithBlocksCommand, {
        textSelection,
        blocks,
      });

      const expected = notesgraph`
        <notesgraph-page>
          <notesgraph-note >
            <notesgraph-list>Hel</notesgraph-list>
            <notesgraph-code></notesgraph-code>
            <notesgraph-list>222ld</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;
      expect(host.store).toEqualDoc(expected.store);
    });
  });
});
