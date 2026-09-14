import { describe, expect, it } from 'vitest';

import {
  parseToolCall,
  stripToolBlocks,
} from '../modules/agents/services/tool-protocol';
import {
  fileNameForTitle,
  readDocId,
  stampDocId,
  stripDocId,
} from '../modules/folder-sync/utils/markdown-file';

describe('markdown file identity', () => {
  it('stamps an id into a file with no frontmatter', () => {
    const out = stampDocId('# Title\n\nbody', 'doc-1');
    expect(readDocId(out)).toBe('doc-1');
    expect(out).toContain('# Title');
  });

  it('preserves frontmatter the user wrote', () => {
    const source = '---\ntitle: Mine\ntags: a, b\n---\n\nbody';
    const out = stampDocId(source, 'doc-2');
    expect(readDocId(out)).toBe('doc-2');
    expect(out).toContain('title: Mine');
    expect(out).toContain('tags: a, b');
    expect(out).toContain('body');
  });

  it('replaces rather than duplicates an existing id', () => {
    const once = stampDocId('body', 'doc-1');
    const twice = stampDocId(once, 'doc-2');
    expect(readDocId(twice)).toBe('doc-2');
    expect(twice.match(/notesgraph-id/g)).toHaveLength(1);
  });

  it('is stable: stamping the same id twice changes nothing', () => {
    const once = stampDocId('body', 'doc-1');
    expect(stampDocId(once, 'doc-1')).toBe(once);
  });

  it('strips the id but keeps other frontmatter', () => {
    const source = stampDocId('---\ntitle: Mine\n---\n\nbody', 'doc-3');
    const stripped = stripDocId(source);
    expect(readDocId(stripped)).toBeNull();
    expect(stripped).toContain('title: Mine');
  });

  it('removes an id-only frontmatter block entirely', () => {
    const stripped = stripDocId(stampDocId('body', 'doc-4'));
    expect(stripped.trim()).toBe('body');
  });

  it('returns null when there is no id', () => {
    expect(readDocId('# plain')).toBeNull();
    expect(readDocId('---\ntitle: x\n---\nbody')).toBeNull();
  });

  it('makes a safe file name, falling back to the id', () => {
    expect(fileNameForTitle('My Note', 'id1')).toBe('My Note.md');
    expect(fileNameForTitle('a/b:c', 'id1')).toBe('a-b-c.md');
    expect(fileNameForTitle('   ', 'id1')).toBe('id1.md');
  });
});

describe('agent tool protocol', () => {
  it('returns null when the model is answering', () => {
    expect(parseToolCall('Here is the summary you asked for.')).toBeNull();
  });

  it('parses a well-formed call', () => {
    const call = parseToolCall(
      'thinking\n```tool\n{"tool": "read_file", "args": {"path": "a.md"}}\n```'
    );
    expect(call).toEqual({ name: 'read_file', args: { path: 'a.md' } });
  });

  it('defaults missing args to an empty object', () => {
    expect(parseToolCall('```tool\n{"tool": "list_files"}\n```')).toEqual({
      name: 'list_files',
      args: {},
    });
  });

  it('throws on a malformed block so the model can retry', () => {
    expect(() => parseToolCall('```tool\nnot json\n```')).toThrow(/valid JSON/);
    expect(() => parseToolCall('```tool\n{"args": {}}\n```')).toThrow(/"tool"/);
  });

  it('strips tool blocks out of an answer', () => {
    const text = 'before\n```tool\n{"tool":"x"}\n```\nafter';
    expect(stripToolBlocks(text)).toBe('before\n\nafter');
  });
});
