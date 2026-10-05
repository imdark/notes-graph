/**
 * What a speaker says between two tasks. Pauses and the punctuation a
 * recognizer guesses from them aren't reliable (people stop to think
 * mid-task), so these words are the only spoken cue.
 * Bare "next" is left alone: "plan next week" is a task, not two.
 */
const SPOKEN_SEPARATOR =
  /\s*\b(?:next|new|another)\s+(?:task|item|to-?do|to do)\b[\s,.:;]*/gi;

/** Filler a speaker leads into the next task with. */
const LEADING_FILLER = /^(?:and then|and|then|also|okay|ok)\b[\s,]*/i;

/**
 * Add a recognized utterance to the transcript. A pause doesn't end a task,
 * so the utterance continues the current line; each spoken separator becomes
 * a line break, so the transcript reads one task per line. Separators split
 * across two utterances ("… next" / "task …") are caught too.
 */
export function appendDictation(transcript: string, utterance: string): string {
  const said = utterance.trim();
  if (!said) return transcript;
  const joined = /(^|\n)\s*$/.test(transcript)
    ? `${transcript}${said}`
    : `${transcript.trimEnd()} ${said}`;
  return joined
    .split('\n')
    .map(line => {
      const parts = line.split(SPOKEN_SEPARATOR).map(part => part.trim());
      // A separator at the very end keeps its break, so what's said next
      // starts a new task.
      return parts
        .filter((part, i) => part || (i > 0 && i === parts.length - 1))
        .join('\n');
    })
    .join('\n');
}

/**
 * Turn dictated text into one task per item: a task ends only at a spoken
 * separator ("next task") or a line break, tidied into something that reads
 * like a typed checklist entry.
 */
export function splitDictatedTasks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap(line => line.split(SPOKEN_SEPARATOR))
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
