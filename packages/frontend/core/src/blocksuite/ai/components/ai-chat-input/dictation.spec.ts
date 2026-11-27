import type {
  SpeechToTextError,
  SpeechToTextHandlers,
} from '@notesgraph/core/modules/voice-tasks';
import { describe, expect, test, vi } from 'vitest';

import { ChatDictation, type ChatSpeechToText } from './dictation';

/** A message box, and a recognizer the test speaks through. */
function setup(initial = '') {
  const box = { text: initial };
  const changes: Array<[boolean, SpeechToTextError | undefined]> = [];
  const dictation = new ChatDictation(
    {
      read: () => box.text,
      write: text => {
        box.text = text;
      },
    },
    (listening, error) => changes.push([listening, error])
  );

  let handlers: SpeechToTextHandlers | null = null;
  const stop = vi.fn(async () => {});
  const speech: ChatSpeechToText = {
    listen: async given => {
      handlers = given;
      return { stop };
    },
  };
  const mic = () => handlers as unknown as SpeechToTextHandlers;
  return { box, dictation, speech, mic, stop, changes };
}

describe('dictating into the chat box', () => {
  test('words go after what is already typed, revised as they come', async () => {
    const { box, dictation, speech, mic } = setup('Summarize this note');
    await dictation.toggle(speech);
    expect(dictation.listening).toBe(true);

    mic().onPartial('and list');
    expect(box.text).toBe('Summarize this note and list');
    mic().onPartial('and list the open');
    expect(box.text).toBe('Summarize this note and list the open');
    mic().onSegment('and list the open tasks');
    expect(box.text).toBe('Summarize this note and list the open tasks');

    mic().onPartial('by owner');
    mic().onSegment('by owner');
    expect(box.text).toBe(
      'Summarize this note and list the open tasks by owner'
    );
  });

  test('an empty box holds only what was said', async () => {
    const { box, dictation, speech, mic } = setup();
    await dictation.toggle(speech);
    mic().onPartial(' hello ');
    expect(box.text).toBe('hello');
  });

  test('typing while listening is kept, and later words follow it', async () => {
    const { box, dictation, speech, mic } = setup();
    await dictation.toggle(speech);
    mic().onSegment('send it to Dana');
    box.text = 'Send it to Dana.';
    mic().onPartial('today');
    expect(box.text).toBe('Send it to Dana. today');
    mic().onSegment('today please');
    expect(box.text).toBe('Send it to Dana. today please');
  });

  test('clearing the box while listening starts over', async () => {
    const { box, dictation, speech, mic } = setup('old');
    await dictation.toggle(speech);
    mic().onSegment('first');
    box.text = '';
    mic().onSegment('second');
    expect(box.text).toBe('second');
  });

  test('a second press stops listening and keeps the words', async () => {
    const { box, dictation, speech, mic, stop, changes } = setup();
    await dictation.toggle(speech);
    mic().onSegment('hello');
    await dictation.toggle(speech);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(dictation.listening).toBe(false);
    expect(box.text).toBe('hello');
    expect(changes).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
  });

  test('nothing heard after stopping reaches the box', async () => {
    const { box, dictation, speech, mic } = setup();
    await dictation.toggle(speech);
    mic().onSegment('hello');
    const late = mic();
    await dictation.stop();
    box.text = '';
    late.onPartial('late word');
    late.onSegment('late word');
    late.onEnd();
    expect(box.text).toBe('');
  });

  test('the recognizer ending on its own, with its error, is reported', async () => {
    const { dictation, speech, mic, changes } = setup();
    await dictation.toggle(speech);
    mic().onEnd('permission-denied');
    expect(dictation.listening).toBe(false);
    expect(changes.at(-1)).toEqual([false, 'permission-denied']);
  });

  test('a recognizer that ends before it has started is not left running', async () => {
    const { dictation, stop } = setup();
    const speech: ChatSpeechToText = {
      listen: async handlers => {
        handlers.onEnd('unavailable');
        return { stop };
      },
    };
    await dictation.toggle(speech);
    expect(dictation.listening).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test('stopping when not listening does nothing', async () => {
    const { dictation, changes } = setup();
    await dictation.stop();
    expect(changes).toEqual([]);
  });
});
