/**
 * What a speaker says between two tasks. Recognizers rarely punctuate, so a
 * pause (one utterance per line) and these words are the reliable cues.
 * Bare "next" is left alone: "plan next week" is a task, not two.
 */
const SPOKEN_SEPARATOR =
  /\s*\b(?:next|new|another)\s+(?:task|item|to-?do|to do)\b[\s,.:;]*/gi;

/** Sentence ends, for recognizers (and typists) that do punctuate. */
const SENTENCE_END = /(?<=[.!?;])\s+/;

/** Filler a speaker leads into the next task with. */
const LEADING_FILLER = /^(?:and then|and|then|also|okay|ok)\b[\s,]*/i;

/**
 * Turn dictated text into one task per item: a line per utterance, split
 * further on spoken separators ("next task") and sentence ends, tidied into
 * something that reads like a typed checklist entry.
 */
export function splitDictatedTasks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap(line => line.split(SPOKEN_SEPARATOR))
    .flatMap(part => part.split(SENTENCE_END))
    .map(tidyTask)
    .filter(task => task.length > 0);
}

function tidyTask(raw: string): string {
  const task = raw
    .trim()
    .replace(LEADING_FILLER, '')
    .replace(/[\s.,;:]+$/, '')
    .trim();
  return task.charAt(0).toUpperCase() + task.slice(1);
}
