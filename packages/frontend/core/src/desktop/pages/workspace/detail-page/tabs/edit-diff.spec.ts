import { describe, expect, test } from 'vitest';

import { diffLines, diffWords, parseEditPreview } from './edit-diff';

const join = (spans: { text: string }[] | null) =>
  spans?.map(s => s.text).join('') ?? null;

describe('diffWords', () => {
  test('marks only the words that changed', () => {
    const { left, right } = diffWords('the quick fox', 'the slow fox');
    expect(left).toEqual([
      { text: 'the ', changed: false },
      { text: 'quick', changed: true },
      { text: ' fox', changed: false },
    ]);
    expect(right).toEqual([
      { text: 'the ', changed: false },
      { text: 'slow', changed: true },
      { text: ' fox', changed: false },
    ]);
  });
});

describe('diffLines', () => {
  test('pairs a replaced line and keeps the rest aligned', () => {
    const rows = diffLines('a\nb\nc', 'a\nB2\nc\nd');
    expect(rows.map(r => r.kind)).toEqual(['same', 'changed', 'same', 'added']);
    expect(join(rows[1].left)).toBe('b');
    expect(join(rows[1].right)).toBe('B2');
    expect(rows[3].left).toBeNull();
    expect(join(rows[3].right)).toBe('d');
  });

  test('a pure removal leaves the right side blank', () => {
    const rows = diffLines('a\nb', 'a');
    expect(rows.map(r => r.kind)).toEqual(['same', 'removed']);
    expect(rows[1].right).toBeNull();
  });

  test('identical text is all same rows', () => {
    expect(diffLines('x\ny', 'x\ny').every(r => r.kind === 'same')).toBe(true);
  });
});

describe('parseEditPreview', () => {
  test('reads an Edit tool input', () => {
    const preview = parseEditPreview(
      'Allow Edit?',
      JSON.stringify({ file_path: '/a.ts', old_string: 'x', new_string: 'y' })
    );
    expect(preview).toEqual({
      tool: 'Edit',
      edits: [{ path: '/a.ts', before: 'x', after: 'y' }],
    });
  });

  test('reads MultiEdit and Write', () => {
    expect(
      parseEditPreview(
        'Allow MultiEdit?',
        JSON.stringify({
          file_path: '/a.ts',
          edits: [
            { old_string: '1', new_string: '2' },
            { old_string: '3', new_string: '4' },
          ],
        })
      )?.edits
    ).toHaveLength(2);
    expect(
      parseEditPreview(
        'Allow Write?',
        JSON.stringify({ file_path: '/b.md', content: 'hi' })
      )
    ).toEqual({
      tool: 'Write',
      edits: [{ path: '/b.md', before: null, after: 'hi' }],
    });
  });

  test('falls back for other tools and clipped JSON', () => {
    expect(
      parseEditPreview('Allow Bash?', JSON.stringify({ command: 'ls' }))
    ).toBeNull();
    expect(
      parseEditPreview('Allow Edit?', '{"file_path": "/a.ts", "old_')
    ).toBeNull();
    expect(parseEditPreview('Allow Edit?', null)).toBeNull();
  });
});
