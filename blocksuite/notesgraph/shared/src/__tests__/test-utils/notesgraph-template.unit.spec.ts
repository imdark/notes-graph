import { TextSelection } from '@blocksuite/std';
import { describe, expect, it } from 'vitest';

import { notesgraph } from '../../test-utils';

describe('helpers/notesgraph-template', () => {
  it('should create a basic document structure from template', () => {
    const host = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">Hello, world</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    expect(host.store).toBeDefined();

    const pageBlock = host.store.getBlock('page');
    expect(pageBlock).toBeDefined();
    expect(pageBlock?.flavour).toBe('notesgraph:page');

    const noteBlock = host.store.getBlock('note');
    expect(noteBlock).toBeDefined();
    expect(noteBlock?.flavour).toBe('notesgraph:note');

    const paragraphBlock = host.store.getBlock('paragraph-1');
    expect(paragraphBlock).toBeDefined();
    expect(paragraphBlock?.flavour).toBe('notesgraph:paragraph');
  });

  it('should handle nested blocks correctly', () => {
    const host = notesgraph`
      <notesgraph-page>
        <notesgraph-note>
          <notesgraph-paragraph>First paragraph</notesgraph-paragraph>
          <notesgraph-list>List item</notesgraph-list>
          <notesgraph-paragraph>Second paragraph</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const noteBlocks = host.store.getBlocksByFlavour('notesgraph:note');
    const paragraphBlocks = host.store.getBlocksByFlavour(
      'notesgraph:paragraph'
    );
    const listBlocks = host.store.getBlocksByFlavour('notesgraph:list');

    expect(noteBlocks.length).toBe(1);
    expect(paragraphBlocks.length).toBe(2);
    expect(listBlocks.length).toBe(1);

    const noteBlock = noteBlocks[0];
    const noteChildren =
      host.store.getBlock(noteBlock.id)?.model.children || [];
    expect(noteChildren.length).toBe(3);

    expect(noteChildren[0].flavour).toBe('notesgraph:paragraph');
    expect(noteChildren[1].flavour).toBe('notesgraph:list');
    expect(noteChildren[2].flavour).toBe('notesgraph:paragraph');
  });

  it('should handle empty blocks correctly', () => {
    const host = notesgraph`
      <notesgraph-page>
        <notesgraph-note>
          <notesgraph-paragraph></notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const paragraphBlocks = host.store.getBlocksByFlavour(
      'notesgraph:paragraph'
    );
    expect(paragraphBlocks.length).toBe(1);

    const paragraphBlock = host.store.getBlock(paragraphBlocks[0].id);
    const paragraphText = paragraphBlock?.model.text?.toString() || '';
    expect(paragraphText).toBe('');
  });

  it('should throw error on invalid template', () => {
    expect(() => {
      notesgraph`
        <unknown-tag></unknown-tag>
      `;
    }).toThrow();
  });

  it('should handle text selection with anchor and focus', () => {
    const host = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">Hel<anchor />lo</notesgraph-paragraph>
          <notesgraph-paragraph id="paragraph-2">Wo<focus />rld</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const selection = host.selection.value[0] as TextSelection;
    expect(selection).toBeDefined();
    expect(selection.is(TextSelection)).toBe(true);
    expect(selection.from.blockId).toBe('paragraph-1');
    expect(selection.from.index).toBe(3);
    expect(selection.from.length).toBe(2);
    expect(selection.to?.blockId).toBe('paragraph-2');
    expect(selection.to?.index).toBe(0);
    expect(selection.to?.length).toBe(2);
  });

  it('should handle cursor position', () => {
    const host = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">Hello<cursor />World</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const selection = host.selection.value[0] as TextSelection;
    expect(selection).toBeDefined();
    expect(selection.is(TextSelection)).toBe(true);
    expect(selection.from.blockId).toBe('paragraph-1');
    expect(selection.from.index).toBe(5);
    expect(selection.from.length).toBe(0);
    expect(selection.to).toBeNull();
  });

  it('should handle selection in empty blocks', () => {
    const host = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1"><cursor /></notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const selection = host.selection.value[0] as TextSelection;
    expect(selection).toBeDefined();
    expect(selection.is(TextSelection)).toBe(true);
    expect(selection.from.blockId).toBe('paragraph-1');
    expect(selection.from.index).toBe(0);
    expect(selection.from.length).toBe(0);
    expect(selection.to).toBeNull();
  });

  it('should handle single point selection', () => {
    const host = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">Hello<anchor></anchor>World<focus></focus>NotesGraph</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    const selection = host.selection.value[0] as TextSelection;
    expect(selection).toBeDefined();
    expect(selection.is(TextSelection)).toBe(true);
    expect(selection.from.blockId).toBe('paragraph-1');
    expect(selection.from.index).toBe(5);
    expect(selection.from.length).toBe(5);
    expect(selection.to).toBeNull();
  });
});
