import { describe, expect, test } from 'vitest';

import { codeRunnerManifest } from '../manifest';
import { formatOutcome, isRunnableLanguage } from './format';

describe('code runner', () => {
  test('runs only JavaScript blocks', () => {
    expect(isRunnableLanguage('javascript')).toBe(true);
    expect(isRunnableLanguage('JS')).toBe(true);
    expect(isRunnableLanguage('python')).toBe(false);
    expect(isRunnableLanguage(null)).toBe(false);
  });

  test('results list the output, then the returned value', () => {
    expect(formatOutcome({ ok: true, logs: ['a', 'b'], value: '3' })).toBe(
      'a\nb\n3'
    );
    expect(formatOutcome({ ok: true, logs: ['a'] })).toBe('a');
  });

  test('a thrown error follows whatever was printed first', () => {
    expect(
      formatOutcome({ ok: false, logs: ['before'], error: 'Error: boom' })
    ).toBe('before\nError: boom');
  });

  test('an empty run says so instead of writing a blank block', () => {
    expect(formatOutcome({ ok: true, logs: [] })).toBe('(no output)');
  });

  test('the manifest asks only for the editor capability', () => {
    expect(codeRunnerManifest.permissions).toEqual(['editor']);
  });
});
