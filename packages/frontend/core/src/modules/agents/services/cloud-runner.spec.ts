/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { unsentCloudMessage } from './cloud-runner';

describe('unsentCloudMessage', () => {
  test('folds the agent system prompt into the first turn', () => {
    expect(
      unsentCloudMessage([
        { role: 'system', content: 'Summarise it.' },
        { role: 'user', content: 'The note.' },
      ])
    ).toBe('<instructions>\nSummarise it.\n</instructions>\n\nThe note.');
  });

  test('leaves out replies the server already keeps', () => {
    expect(
      unsentCloudMessage([
        { role: 'assistant', content: '```tool\n{}\n```' },
        { role: 'user', content: 'Result of read_file:\nhello' },
      ])
    ).toBe('Result of read_file:\nhello');
  });
});
