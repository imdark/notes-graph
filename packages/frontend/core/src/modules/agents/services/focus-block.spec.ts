import { describe, expect, test } from 'vitest';

import { lastBlockTouched } from './focus-block';
import { stampLines } from './log-lines';

const at = Date.parse('2026-10-03T12:00:00.000Z');

describe('lastBlockTouched', () => {
  test('the latest call naming a block wins', () => {
    const log = stampLines(
      [
        '→ mcp__notesgraph__update_task  {"docId": "d1", "blockId": "b1", "status": "in-progress"}',
        '← ok',
        '→ mcp__notesgraph__update_task  {"docId": "d1", "blockId": "b2", "status": "done"}',
        '→ mcp__notesgraph__read_document  {"docId": "d1"}',
        '',
      ].join('\n'),
      at
    );
    expect(lastBlockTouched(log)).toEqual({ docId: 'd1', blockId: 'b2' });
  });

  test('reads clipped args and subagent calls', () => {
    const log =
      '    ↳ → update_block  {"blockId":"b3","docId":"d2","text":"a very long te…\n';
    expect(lastBlockTouched(log)).toEqual({ docId: 'd2', blockId: 'b3' });
  });

  test("a call without a note is in the run's own note", () => {
    expect(lastBlockTouched('→ update_task  {"blockId": "b4"}\n', 'd3')).toEqual(
      { docId: 'd3', blockId: 'b4' }
    );
    expect(lastBlockTouched('→ update_task  {"blockId": "b4"}\n')).toBeNull();
  });

  test('block ids in results or prose are not calls', () => {
    const log = '← [{"docId": "d1", "blockId": "b9"}]\nworking on "blockId": "x"\n';
    expect(lastBlockTouched(log)).toBeNull();
  });
});
