/**
 * Run transcripts are plain text where each line starts with the time it was
 * written, as `[<ISO time>] `. The server stamps remote runs' lines as the
 * device reports them (models/inventory-job.ts in the server); on-device runs
 * are stamped here as the executor logs. Lines from before stamping existed,
 * or continuation lines, simply have no time.
 */

const STAMP = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\] /;

export const logStamp = (at: number) => `[${new Date(at).toISOString()}] `;

/** Stamp every line start in `text`, which must itself start a line. */
export const stampLines = (text: string, at: number): string => {
  const stamp = logStamp(at);
  return stamp + text.replace(/\n(?=[^\n])/g, `\n${stamp}`);
};

export interface LogLine {
  /** 1-based, as shown in the gutter. */
  number: number;
  /** When the line was written, if it carries a stamp. */
  at: number | null;
  text: string;
}

export const parseLogLines = (log: string): LogLine[] => {
  if (!log) return [];
  // A trailing newline ends the last line rather than starting an empty one.
  const raw = (log.endsWith('\n') ? log.slice(0, -1) : log).split('\n');
  return raw.map((line, i) => {
    const match = STAMP.exec(line);
    return match
      ? {
          number: i + 1,
          at: Date.parse(match[1]),
          text: line.slice(match[0].length),
        }
      : { number: i + 1, at: null, text: line };
  });
};
