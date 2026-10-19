import { describe, expect, test } from 'vitest';

import { changesAreEmpty, parsePatch } from './run-changes';

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  ' export { a, b };',
  'diff --git a/notes.md b/notes.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/notes.md',
  '@@ -0,0 +1,2 @@',
  '+# Notes',
  '+hello',
  '\\ No newline at end of file',
  'diff --git a/old.txt b/old.txt',
  'deleted file mode 100644',
  '--- a/old.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  '',
].join('\n');

describe('parsePatch', () => {
  test('splits a git diff into files with numbered lines', () => {
    const files = parsePatch(PATCH);
    expect(files.map(f => [f.path, f.status])).toEqual([
      ['src/app.ts', 'modified'],
      ['notes.md', 'added'],
      ['old.txt', 'deleted'],
    ]);

    const [hunk] = files[0].hunks;
    expect(hunk.lines.map(l => [l.kind, l.text, l.oldNo, l.newNo])).toEqual([
      ['context', 'const a = 1;', 1, 1],
      ['removed', 'const b = 2;', 2, null],
      ['added', 'const b = 3;', null, 2],
      ['context', 'export { a, b };', 3, 3],
    ]);
    expect(files[1].hunks[0].lines.at(-1)?.kind).toBe('note');
  });

  test('reads a rename and a binary file', () => {
    const files = parsePatch(
      [
        'diff --git a/a.png b/b.png',
        'similarity index 90%',
        'rename from a.png',
        'rename to b.png',
        'Binary files a/a.png and b/b.png differ',
      ].join('\n')
    );
    expect(files).toEqual([
      { path: 'b.png', oldPath: 'a.png', status: 'binary', hunks: [] },
    ]);
  });

  test('an empty patch has no files', () => {
    expect(parsePatch('')).toEqual([]);
  });
});

describe('changesAreEmpty', () => {
  test('is true for nothing recorded, false once anything is', () => {
    expect(changesAreEmpty(null)).toBe(true);
    expect(changesAreEmpty({ notes: { created: [] }, files: [] })).toBe(true);
    expect(
      changesAreEmpty({ notes: { created: [{ docId: 'd', title: 't' }] } })
    ).toBe(false);
  });
});
