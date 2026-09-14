import { describe, expect, test } from 'vitest';

import {
  isKeepNote,
  type KeepNote,
  keepNoteToMarkdown,
} from '../google-keep-import';

describe('isKeepNote', () => {
  test('accepts text, list, and titled note shapes', () => {
    expect(isKeepNote({ textContent: 'hi' })).toBe(true);
    expect(isKeepNote({ listContent: [] })).toBe(true);
    expect(isKeepNote({ title: 'T', isArchived: false })).toBe(true);
  });

  test('rejects non-Keep json', () => {
    expect(isKeepNote(null)).toBe(false);
    expect(isKeepNote('string')).toBe(false);
    expect(isKeepNote({ foo: 'bar' })).toBe(false);
    expect(isKeepNote({ title: 'just a title' })).toBe(false);
  });
});

describe('keepNoteToMarkdown', () => {
  test('a text note keeps its title and body', () => {
    const note: KeepNote = { title: 'Groceries', textContent: 'milk\neggs' };
    const out = keepNoteToMarkdown(note);
    expect(out.title).toBe('Groceries');
    expect(out.markdown).toBe('milk\neggs');
  });

  test('a checklist note becomes markdown todo items', () => {
    const note: KeepNote = {
      title: 'Todo',
      listContent: [
        { text: 'done thing', isChecked: true },
        { text: 'open thing', isChecked: false },
      ],
    };
    const out = keepNoteToMarkdown(note);
    expect(out.markdown).toBe('- [x] done thing\n- [ ] open thing');
  });

  test('labels are extracted; annotations and attachments append', () => {
    const note: KeepNote = {
      title: 'Trip',
      textContent: 'plan',
      labels: [{ name: 'travel' }, { name: 'todo' }, { name: '' }],
      annotations: [
        { url: 'https://x.com', title: 'X', source: 'WEBLINK' },
        { source: 'WEBLINK' }, // no url → dropped
      ],
      attachments: [{ filePath: 'photo.jpg', mimetype: 'image/jpeg' }],
    };
    const out = keepNoteToMarkdown(note);
    expect(out.labels).toEqual(['travel', 'todo']);
    expect(out.markdown).toContain('plan');
    expect(out.markdown).toContain('- [X](https://x.com)');
    expect(out.markdown).toContain('📎 Attachment: photo.jpg');
  });

  test('an untitled note falls back to its first line, then "Untitled"', () => {
    expect(keepNoteToMarkdown({ textContent: 'first line\nsecond' }).title).toBe(
      'first line'
    );
    expect(keepNoteToMarkdown({ textContent: '' }).title).toBe('Untitled');
    expect(keepNoteToMarkdown({}).title).toBe('Untitled');
  });

  test('trashed / archived / pinned flags pass through', () => {
    const out = keepNoteToMarkdown({
      title: 'x',
      isTrashed: true,
      isArchived: true,
      isPinned: true,
    });
    expect(out.isTrashed).toBe(true);
    expect(out.isArchived).toBe(true);
    expect(out.isPinned).toBe(true);
  });
});
