# NotesGraph Test Tools

## Structured Document Creation

`notesgraph-template.ts` provides a concise way to create test documents, using a html-like syntax.

### Basic Usage

```typescript
import { notesgraph } from '@blocksuite/notesgraph-shared/test-utils';

// Create a simple document
const doc = notesgraph`
  <notesgraph-page>
    <notesgraph-note>
      <notesgraph-paragraph>Hello, World!</notesgraph-paragraph>
    </notesgraph-note>
  </notesgraph-page>
`;
```

### Complex Structure Example

```typescript
// Create a document with multiple notes and paragraphs
const doc = notesgraph`
  <notesgraph-page title="My Test Page">
    <notesgraph-note>
      <notesgraph-paragraph>First paragraph</notesgraph-paragraph>
      <notesgraph-paragraph>Second paragraph</notesgraph-paragraph>
    </notesgraph-note>
    <notesgraph-note>
      <notesgraph-paragraph>Another note</notesgraph-paragraph>
    </notesgraph-note>
  </notesgraph-page>
`;
```

### Application in Tests

This tool is particularly suitable for creating documents with specific structures in test cases:

```typescript
import { describe, expect, it } from 'vitest';
import { notesgraph } from '../__tests__/utils/notesgraph-template';

describe('My Test', () => {
  it('should correctly handle document structure', () => {
    const doc = notesgraph`
      <notesgraph-page>
        <notesgraph-note>
          <notesgraph-paragraph>Test content</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    // Get blocks
    const pages = doc.getBlocksByFlavour('notesgraph:page');
    const notes = doc.getBlocksByFlavour('notesgraph:note');
    const paragraphs = doc.getBlocksByFlavour('notesgraph:paragraph');

    expect(pages.length).toBe(1);
    expect(notes.length).toBe(1);
    expect(paragraphs.length).toBe(1);

    // Perform more tests here...
  });
});
```

### Supported Block Types

Currently supports the following block types:

- `notesgraph-page` → `notesgraph:page`
- `notesgraph-note` → `notesgraph:note`
- `notesgraph-paragraph` → `notesgraph:paragraph`
- `notesgraph-list` → `notesgraph:list`
- `notesgraph-image` → `notesgraph:image`
