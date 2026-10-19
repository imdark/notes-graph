import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ChangeRecorder, gitBase, gitChanges } from '../changes';

const text = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }];

describe('recording what a run changed', () => {
  test('notes created, edited and linked, from results that succeeded', () => {
    const r = new ChangeRecorder('/w');
    r.onToolUse('c1', 'mcp__notesgraph__create_document', { title: '  Movie\n  night ' });
    r.onToolResult('c1', text({ success: true, docId: 'd1' }), false);
    // Editing a doc the run created is part of creating it.
    r.onToolUse('e0', 'mcp__notesgraph__update_document', { docId: 'd1', markdown: 'x' });
    r.onToolResult('e0', text({ success: true }), false);
    r.onToolUse('e1', 'mcp__notesgraph__update_block', { docId: 'd2', blockId: 'b' });
    r.onToolResult('e1', text({ success: true }), false);
    r.onToolUse('e2', 'mcp__notesgraph__update_document_meta', { docId: 'd2', title: 'Shows' });
    r.onToolResult('e2', text({ success: true }), false);
    r.onToolUse('e3', 'mcp__notesgraph__update_task', { blockId: 'b' });
    r.onToolResult('e3', text({ success: true, docId: 'd3' }), false);
    r.onToolUse('l1', 'mcp__notesgraph__link_document', { parentDocId: 'd2', childDocId: 'd1' });
    r.onToolResult('l1', text({ success: true, parentDocId: 'd2', childDocId: 'd1' }), false);
    // Errored, and a tool that changes nothing: not recorded.
    r.onToolUse('x1', 'mcp__notesgraph__create_document', { title: 'Nope' });
    r.onToolResult('x1', 'boom', true);
    r.onToolUse('x2', 'mcp__notesgraph__read_document', { docId: 'd9' });
    r.onToolResult('x2', text({ docId: 'd9' }), false);
    expect(r.build()).toEqual({
      notes: {
        created: [{ docId: 'd1', title: 'Movie night' }],
        edited: [{ docId: 'd2', title: 'Shows' }, { docId: 'd3' }],
        linked: [{ parentDocId: 'd2', childDocId: 'd1' }],
      },
      files: [],
    });
  });

  test('files edited and written, relative to the job cwd', () => {
    const r = new ChangeRecorder('/w/repo');
    r.onToolUse('a', 'Edit', { file_path: '/w/repo/src/a.ts', old_string: 'x', new_string: 'y' });
    r.onToolResult('a', 'ok', false);
    r.onToolUse('b', 'MultiEdit', {
      file_path: '/w/repo/b.ts',
      edits: [
        { old_string: '1', new_string: '2' },
        { old_string: '3', new_string: '4' },
      ],
    });
    r.onToolResult('b', [{ type: 'text', text: 'ok' }], false);
    r.onToolUse('c', 'Write', { file_path: '/elsewhere/c.md', content: 'hello' });
    r.onToolResult('c', 'ok', false);
    r.onToolUse('d', 'NotebookEdit', { notebook_path: '/w/repo/n.ipynb', new_source: 'print(1)' });
    r.onToolResult('d', 'ok', false);
    r.onToolUse('e', 'Edit', { file_path: '/w/repo/e.ts', old_string: 'q', new_string: 'r' });
    r.onToolResult('e', 'String not found', true);
    expect(r.build()?.files).toEqual([
      { path: 'src/a.ts', before: 'x', after: 'y' },
      { path: 'b.ts', before: '1', after: '2' },
      { path: 'b.ts', before: '3', after: '4' },
      { path: '/elsewhere/c.md', before: null, after: 'hello' },
      { path: 'n.ipynb', before: null, after: 'print(1)' },
    ]);
  });

  test('nothing changed is nothing to report', () => {
    const r = new ChangeRecorder('/w');
    r.onToolUse('a', 'Read', { file_path: '/w/a' });
    r.onToolResult('a', 'text', false);
    expect(r.build()).toBeUndefined();
  });

  test('long texts are cut, and the lists capped', () => {
    const r = new ChangeRecorder('/w');
    for (let i = 0; i < 60; i++) {
      r.onToolUse(`w${i}`, 'Write', { file_path: `/w/f${i}`, content: 'z'.repeat(9000) });
      r.onToolResult(`w${i}`, 'ok', false);
    }
    for (let i = 0; i < 120; i++) {
      r.onToolUse(`c${i}`, 'mcp__notesgraph__create_document', { title: `T${i}` });
      r.onToolResult(`c${i}`, text({ success: true, docId: `d${i}` }), false);
    }
    const changes = r.build()!;
    expect(changes.notes.created).toHaveLength(100);
    expect(changes.files.length).toBeLessThanOrEqual(50);
    expect(changes.files[0].after).toBe(`${'z'.repeat(8000)}\n… (cut)`);
    expect(JSON.stringify(changes).length).toBeLessThan(200_000);
  });
});

describe('what a run did in git', () => {
  let dir: string;
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-runner-git-'));
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 't@example.com');
    run('config', 'user.name', 'T');
    run('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'a.txt'), 'one\n');
    run('add', '.');
    run('commit', '-q', '-m', 'start');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('commits, uncommitted edits and untracked files since the base', async () => {
    const base = (await gitBase(dir))!;
    expect(base).toBe(run('rev-parse', 'HEAD'));
    expect(await gitChanges(dir, base)).toBeUndefined();

    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
    run('commit', '-q', '-am', 'add two');
    await writeFile(join(dir, 'a.txt'), 'uno\ntwo\n');
    await writeFile(join(dir, 'new.txt'), 'fresh\nlines\n');

    const changes = (await gitChanges(dir, base))!;
    expect(changes.base).toBe(base);
    expect(changes.head).toBe(run('rev-parse', 'HEAD'));
    expect(changes.branch).toBe('main');
    expect(changes.commits).toEqual([{ sha: run('rev-parse', '--short', 'HEAD'), subject: 'add two' }]);
    expect(changes.stat).toEqual([
      { path: 'a.txt', added: 2, removed: 1 },
      { path: 'new.txt', added: 2, removed: 0 },
    ]);
    expect(changes.patch).toContain('+uno');
    expect(changes.patch).toContain('+fresh');
    expect(changes.truncated).toBe(false);
  });

  test('outside a checkout there is no git to report', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'agent-runner-plain-'));
    try {
      expect(await gitBase(plain)).toBeUndefined();
      expect(await gitChanges(plain, 'deadbeef')).toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
