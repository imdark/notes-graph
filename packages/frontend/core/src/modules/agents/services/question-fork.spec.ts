import { describe, expect, test } from 'vitest';

import { forkMessages, forkTranscript, splitSuggestion } from './question-fork';
import type { RemoteQuestion } from './remote-runner';

const question = (over: Partial<RemoteQuestion> = {}): RemoteQuestion => ({
  id: 'q1',
  kind: 'question',
  text: 'Which branch should I use?',
  detail: null,
  answer: null,
  allowed: null,
  createdAt: 0,
  answeredAt: null,
  ...over,
});

describe('forkTranscript', () => {
  test('drops the time stamps', () => {
    const log =
      '[2026-10-03T10:00:00.000Z] ── step 1\n[2026-10-03T10:00:01.000Z] reading notes\n';
    expect(forkTranscript(log)).toBe('── step 1\nreading notes');
  });

  test('keeps the end of a long transcript, from a line start', () => {
    const log = ['first line', 'second line', 'third line'].join('\n');
    expect(forkTranscript(log, 15)).toBe('…\nthird line');
  });
});

describe('forkMessages', () => {
  test('gives the question, choices and transcript', () => {
    const [system, user] = forkMessages(
      question({ options: ['main', 'dev'] }),
      'did some work'
    );
    expect(system.role).toBe('system');
    expect(system.content).toContain('Suggested answer:');
    expect(user.content).toContain('The agent asks: Which branch should I use?');
    expect(user.content).toContain('Choices it offered: main | dev');
    expect(user.content).toContain('<transcript>\ndid some work\n</transcript>');
  });

  test('a permission asks for allow or deny, not a suggested answer', () => {
    const [system, user] = forkMessages(
      question({ kind: 'permission', text: 'Bash', detail: 'rm -rf dist' }),
      ''
    );
    expect(system.content).not.toContain('Suggested answer:');
    expect(user.content).toContain('Tool input:\nrm -rf dist');
    expect(user.content).toContain('no transcript');
  });
});

describe('splitSuggestion', () => {
  test('takes the suggestion line out of the reply', () => {
    expect(
      splitSuggestion('It is about the release.\n\nSuggested answer: "dev"')
    ).toEqual({ text: 'It is about the release.', suggestion: 'dev' });
  });

  test('a reply without one is left alone', () => {
    expect(splitSuggestion('No idea yet.')).toEqual({
      text: 'No idea yet.',
      suggestion: null,
    });
  });
});
