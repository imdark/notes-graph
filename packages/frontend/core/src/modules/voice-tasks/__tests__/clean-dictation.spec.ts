import { describe, expect, test } from 'vitest';

import {
  applyVocabulary,
  buildVocabulary,
  cleanDictation,
  removeFillers,
} from '../utils/clean-dictation';

describe('removeFillers', () => {
  test('drops hesitations and recapitalizes', () => {
    expect(removeFillers('Um, so I think, uh, we ship it.')).toBe(
      'So I think, we ship it.'
    );
    expect(removeFillers('uhh hmm call mom')).toBe('call mom');
    expect(removeFillers('It was, erm, fine. Mm, okay.')).toBe(
      'It was, fine. Okay.'
    );
  });

  test('drops "you know" and "I mean" only when set off by commas', () => {
    expect(removeFillers('It is, you know, broken.')).toBe('It is, broken.');
    expect(removeFillers('Do you know the answer?')).toBe(
      'Do you know the answer?'
    );
    expect(removeFillers('I mean it.')).toBe('I mean it.');
  });

  test('collapses stutters but keeps deliberate repeats', () => {
    expect(removeFillers('the the the plan is set')).toBe('the plan is set');
    expect(removeFillers('I know that that works')).toBe(
      'I know that that works'
    );
  });

  test('leaves words that only contain filler letters', () => {
    expect(removeFillers('Ahmed hummed under the umbrella')).toBe(
      'Ahmed hummed under the umbrella'
    );
    expect(removeFillers('like, so, really good')).toBe(
      'like, so, really good'
    );
  });

  test('leaves clean text untouched', () => {
    expect(removeFillers('buy milk')).toBe('buy milk');
    expect(removeFillers('')).toBe('');
  });
});

describe('buildVocabulary', () => {
  test('keeps camel-case words and acronyms, skips ordinary words and ids', () => {
    const terms = buildVocabulary([
      'NotesGraph capture ideas',
      'Fix the TTS in FleetView',
      'PERSONAL-217 work',
      'work',
      'Notes health 2026-11-02',
    ]).map(v => v.term);
    expect(terms).toEqual(['NotesGraph', 'TTS', 'FleetView']);
  });
});

describe('applyVocabulary', () => {
  const vocab = buildVocabulary(['NotesGraph', 'FleetView', 'TTS', 'IT']);

  test('joins a spoken phrase into the term', () => {
    expect(applyVocabulary('open the notes graph app', vocab)).toBe(
      'open the NotesGraph app'
    );
    expect(applyVocabulary('Fleet view, again.', vocab)).toBe(
      'FleetView, again.'
    );
  });

  test('takes near misses of long terms', () => {
    expect(applyVocabulary('in notes graf today', vocab)).toBe(
      'in NotesGraph today'
    );
    expect(applyVocabulary('the flete view', vocab)).toBe('the FleetView');
  });

  test('short acronyms only when spelled out', () => {
    expect(applyVocabulary('make it read aloud with t t s', vocab)).toBe(
      'make it read aloud with TTS'
    );
    expect(applyVocabulary('it works', vocab)).toBe('it works');
  });

  test('does not join across punctuation or touch other words', () => {
    expect(applyVocabulary('notes. Graph', vocab)).toBe('notes. Graph');
    expect(applyVocabulary('call the dentist', vocab)).toBe('call the dentist');
  });

  test('keeps the original spacing', () => {
    expect(applyVocabulary('a  notes graph\tb', vocab)).toBe(
      'a  NotesGraph\tb'
    );
  });
});

test('cleanDictation does both', () => {
  const vocab = buildVocabulary(['NotesGraph']);
  expect(cleanDictation('Um, add a widget to notes graph.', vocab)).toBe(
    'Add a widget to NotesGraph.'
  );
});
