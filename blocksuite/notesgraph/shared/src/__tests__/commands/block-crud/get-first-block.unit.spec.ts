/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { getFirstBlockCommand } from '../../../commands/block-crud/get-first-content-block';
import { notesgraph } from '../../../test-utils';

describe('commands/block-crud', () => {
  describe('getFirstBlockCommand', () => {
    it('should return null when root is not exists', () => {
      const host = notesgraph`<notesgraph-page></notesgraph-page>`;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'content',
        root: undefined,
      });

      expect(firstBlock).toBeNull();
    });

    it('should return first block with content role when found', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1-1">First Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-1-2">Second Paragraph</notesgraph-paragraph>
          </notesgraph-note>
          <notesgraph-note id="note-2">
            <notesgraph-paragraph id="paragraph-2-1">First Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2-2">Second Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'hub',
        root: undefined,
      });

      expect(firstBlock?.id).toBe('note-1');
    });

    it('should return first block with any role in the array when found', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1-1">First Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-1-2">Second Paragraph</notesgraph-paragraph>
          </notesgraph-note>
          <notesgraph-note id="note-2">
            <notesgraph-paragraph id="paragraph-2-1">First Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2-2">Second Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: ['hub', 'content'],
        root: undefined,
      });

      expect(firstBlock?.id).toBe('note-1');
    });

    it('should return first block with specified flavour when found', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Paragraph</notesgraph-paragraph>
            <notesgraph-list id="list-1">List Item</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        flavour: 'notesgraph:list',
        root: note,
      });

      expect(firstBlock?.id).toBe('list-1');
    });

    it('should return first block with any flavour in the array when found', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Paragraph</notesgraph-paragraph>
            <notesgraph-list id="list-1">List Item</notesgraph-list>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        flavour: ['notesgraph:list', 'notesgraph:code'],
        root: note,
      });

      expect(firstBlock?.id).toBe('list-1');
    });

    it('should return first block matching both role and flavour when both specified', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Content Paragraph</notesgraph-paragraph>
            <notesgraph-list id="list-1">Content List</notesgraph-list>
            <notesgraph-paragraph id="paragraph-2">hub Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;
      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'content',
        flavour: 'notesgraph:list',
        root: note,
      });

      expect(firstBlock?.id).toBe('list-1');
    });

    it('should return first block with default roles when role not specified', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">hub Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">Content Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-3">Hub Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        root: undefined,
      });

      expect(firstBlock?.id).toBe('note-1');
    });

    it('should return first block with specified role when found', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Content Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">hub Paragraph</notesgraph-paragraph>
            <notesgraph-database id="database-1">Database</notesgraph-database>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'hub',
        root: note,
      });

      expect(firstBlock?.id).toBe('database-1');
    });

    it('should return null when no blocks with specified role are found in children', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Content Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">Another Content Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'hub',
        root: note,
      });

      expect(firstBlock).toBeNull();
    });

    it('should return null when no blocks with specified flavour are found in children', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1">Paragraph</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2">Another Paragraph</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-1')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        flavour: 'notesgraph:list',
        root: note,
      });

      expect(firstBlock).toBeNull();
    });

    it('should return first block with specified role within specified root subtree', () => {
      const host = notesgraph`
        <notesgraph-page>
          <notesgraph-note id="note-1">
            <notesgraph-paragraph id="paragraph-1-1">1-1 Content</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-1-2">1-2 hub</notesgraph-paragraph>
          </notesgraph-note>
          <notesgraph-note id="note-2">
            <notesgraph-paragraph id="paragraph-2-1">2-1 hub</notesgraph-paragraph>
            <notesgraph-paragraph id="paragraph-2-2">2-2 Content</notesgraph-paragraph>
          </notesgraph-note>
        </notesgraph-page>
      `;

      const note = host.store.getBlock('note-2')?.model;

      const [_, { firstBlock }] = host.command.exec(getFirstBlockCommand, {
        role: 'content',
        root: note,
      });

      expect(firstBlock?.id).toBe('paragraph-2-1');
    });
  });
});
