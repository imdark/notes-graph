import { literal } from 'lit/static-html.js';
import { describe, expect, it, vi } from 'vitest';

import { BlockSchemaExtension } from '../extension/schema.js';
import { defineBlockSchema } from '../model/block/zod.js';
// import some blocks
import { SchemaValidateError } from '../schema/error.js';
import { createAutoIncrementIdGenerator } from '../test/index.js';
import { TestWorkspace } from '../test/test-workspace.js';
import {
  DividerBlockSchemaExtension,
  ListBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from './test-schema.js';

function createTestOptions() {
  const idGenerator = createAutoIncrementIdGenerator();
  return { id: 'test-collection', idGenerator };
}

const TestCustomNoteBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:note-block-video',
  props: internal => ({
    text: internal.Text(),
  }),
  metadata: {
    version: 1,
    role: 'content',
    tag: literal`notesgraph-note-block-video`,
    parent: ['notesgraph:note'],
  },
});

const TestCustomNoteBlockSchemaExtension = BlockSchemaExtension(
  TestCustomNoteBlockSchema
);

const TestInvalidNoteBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:note-invalid-block-video',
  props: internal => ({
    text: internal.Text(),
  }),
  metadata: {
    version: 1,
    role: 'content',
    tag: literal`notesgraph-invalid-note-block-video`,
    parent: ['notesgraph:note'],
  },
});

const TestInvalidNoteBlockSchemaExtension = BlockSchemaExtension(
  TestInvalidNoteBlockSchema
);

const TestRoleBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:note-block-role-test',
  metadata: {
    version: 1,
    role: 'content',
    parent: ['notesgraph:note'],
    children: ['@test'],
  },
  props: internal => ({
    text: internal.Text(),
  }),
});

const TestRoleBlockSchemaExtension = BlockSchemaExtension(TestRoleBlockSchema);

const TestParagraphBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:test-paragraph',
  metadata: {
    version: 1,
    role: 'test',
    parent: ['@content'],
  },
});

const TestParagraphBlockSchemaExtension = BlockSchemaExtension(
  TestParagraphBlockSchema
);

const extensions = [
  RootBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  ListBlockSchemaExtension,
  NoteBlockSchemaExtension,
  DividerBlockSchemaExtension,
  TestCustomNoteBlockSchemaExtension,
  TestInvalidNoteBlockSchemaExtension,
  TestRoleBlockSchemaExtension,
  TestParagraphBlockSchemaExtension,
];

const defaultDocId = 'doc0';
function createTestDoc(docId = defaultDocId) {
  const options = createTestOptions();
  const collection = new TestWorkspace(options);
  collection.meta.initialize();
  const doc = collection.createDoc(docId);
  doc.load();
  const store = doc.getStore({ extensions });
  return store;
}

describe('schema', () => {
  it('should be able to validate schema by role', () => {
    const consoleMock = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const doc = createTestDoc();
    const rootId = doc.addBlock('notesgraph:page', {});
    const noteId = doc.addBlock('notesgraph:note', {}, rootId);
    const paragraphId = doc.addBlock('notesgraph:paragraph', {}, noteId);

    doc.addBlock('notesgraph:note', {});
    expect(consoleMock.mock.calls[0]).toSatisfy((call: unknown[]) => {
      return typeof call[0] === 'string';
    });
    expect(consoleMock.mock.calls[1]).toSatisfy((call: unknown[]) => {
      return call[0] instanceof SchemaValidateError;
    });

    consoleMock.mockClear();
    // add paragraph to root should throw
    doc.addBlock('notesgraph:paragraph', {}, rootId);
    expect(consoleMock.mock.calls[0]).toSatisfy((call: unknown[]) => {
      return typeof call[0] === 'string';
    });
    expect(consoleMock.mock.calls[1]).toSatisfy((call: unknown[]) => {
      return call[0] instanceof SchemaValidateError;
    });

    consoleMock.mockClear();
    doc.addBlock('notesgraph:note', {}, rootId);
    doc.addBlock('notesgraph:paragraph', {}, noteId);
    doc.addBlock('notesgraph:paragraph', {}, paragraphId);
    expect(consoleMock).not.toBeCalled();
  });

  it('should glob match works', () => {
    const consoleMock = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const doc = createTestDoc();
    const rootId = doc.addBlock('notesgraph:page', {});
    const noteId = doc.addBlock('notesgraph:note', {}, rootId);

    doc.addBlock('notesgraph:note-block-video', {}, noteId);
    expect(consoleMock).not.toBeCalled();

    doc.addBlock('notesgraph:note-invalid-block-video', {}, noteId);
    expect(consoleMock.mock.calls[0]).toSatisfy((call: unknown[]) => {
      return typeof call[0] === 'string';
    });
    expect(consoleMock.mock.calls[1]).toSatisfy((call: unknown[]) => {
      return call[0] instanceof SchemaValidateError;
    });
  });

  it('should be able to validate schema by role', () => {
    const consoleMock = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const doc = createTestDoc();
    const rootId = doc.addBlock('notesgraph:page', {});
    const noteId = doc.addBlock('notesgraph:note', {}, rootId);
    const roleId = doc.addBlock('notesgraph:note-block-role-test', {}, noteId);

    doc.addBlock('notesgraph:paragraph', {}, roleId);
    doc.addBlock('notesgraph:paragraph', {}, roleId);

    expect(consoleMock.mock.calls[1]).toSatisfy((call: unknown[]) => {
      return call[0] instanceof SchemaValidateError;
    });

    consoleMock.mockClear();
    doc.addBlock('notesgraph:test-paragraph', {}, roleId);
    doc.addBlock('notesgraph:test-paragraph', {}, roleId);
    expect(consoleMock).not.toBeCalled();

    expect(doc.getBlocksByFlavour('notesgraph:test-paragraph')).toHaveLength(2);
  });
});
