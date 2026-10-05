/**
 * What a speaker says between two tasks. A pause isn't a cue: people stop to
 * think mid-task, so only these words end one. Bare "next" is left alone:
 * "plan next week" is a task, not two.
 */
const SPOKEN_SEPARATOR =
  /\s*\b(?:next|new|another)\s+(?:task|item|to-?do|to do)\b[\s,.:;]*/gi;

/** Filler a speaker leads into the next task with. */
const LEADING_FILLER = /^(?:and then|and|then|also|okay|ok)\b[\s,]*/i;

/**
 * Add a finished utterance to the transcript. Utterances end wherever the
 * speaker paused, so it continues the current task's line; a spoken separator
 * (in it, or straddling the pause) becomes a line break, leaving one task per
 * line for the speaker to check.
 */
export function appendDictation(transcript: string, utterance: string): string {
  // Recognizers that punctuate close every utterance with a period; that marks
  // the pause, not the end of the task.
  const words = utterance.trim().replace(/[.,]+$/, '');
  if (!words) return transcript;
  const joined =
    !transcript.trim() || transcript.endsWith('\n')
      ? `${transcript.trimStart()}${words}`
      : `${transcript.trimEnd()} ${words}`;
  return joined.replace(SPOKEN_SEPARATOR, '\n').replace(/^\n+/, '');
}

/**
 * Turn dictated text into one task per item: split on line breaks (what the
 * speaker typed or appendDictation made) and spoken separators ("next task"),
 * tidied into something that reads like a typed checklist entry.
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
