import { describe, expect, test } from 'vitest';

import { parseToolInput } from './tool-input';

describe('parseToolInput', () => {
  test('lays out a Bash call: description, command, the rest as fields', () => {
    const preview = parseToolInput(
      'Allow Bash?',
      JSON.stringify({
        command: 'git status\ngit log -1',
        description: 'Show working tree status',
        timeout: 120000,
        run_in_background: false,
      })
    );
    expect(preview).toEqual({
      tool: 'Bash',
      description: 'Show working tree status',
      command: 'git status\ngit log -1',
      fields: [
        { label: 'Timeout', value: '120000', block: false },
        { label: 'Run in background', value: 'no', block: false },
      ],
    });
  });

  test('other tools become labelled fields; long or nested values get a box', () => {
    const preview = parseToolInput(
      'Allow WebFetch?',
      JSON.stringify({
        url: 'https://example.com',
        prompt: 'x'.repeat(100),
        headers: { a: 1 },
        empty: '',
      })
    );
    expect(preview?.command).toBeNull();
    expect(preview?.fields).toEqual([
      { label: 'Url', value: 'https://example.com', block: false },
      { label: 'Prompt', value: 'x'.repeat(100), block: true },
      { label: 'Headers', value: '{\n  "a": 1\n}', block: true },
    ]);
  });

  test('falls back to the raw detail when it is not a JSON object', () => {
    expect(parseToolInput('Allow Bash?', '{"command": "ls')).toBeNull();
    expect(parseToolInput('Allow Bash?', '["ls"]')).toBeNull();
    expect(parseToolInput('Allow Bash?', null)).toBeNull();
  });
});
