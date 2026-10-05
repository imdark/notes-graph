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

/**
 * A tool call (`→ <tool>  <args>`) or its indented result (`  ← …` / `  ✗ …`),
 * as both on-device runs (executor.ts) and device runs (`wf agent serve`)
 * write them; a device's subagent lines are indented under a `↳`. A run's
 * own `✗ failed …` line is not indented, so it stays out.
 */
const TOOL_CALL = /^\s*(?:↳ )?→ (\S+)/;
const TOOL_RESULT = /^(?:\s*↳)?\s+[←✗] /;

export type LogSegment =
  | { kind: 'line'; line: LogLine }
  /** A run of consecutive tool lines, shown folded by default. */
  | { kind: 'tools'; lines: LogLine[]; tools: string[] };

/** Fold each run of consecutive tool call/result lines into one segment. */
export const groupLogLines = (lines: LogLine[]): LogSegment[] => {
  const segments: LogSegment[] = [];
  for (const line of lines) {
    const call = TOOL_CALL.exec(line.text);
    if (!call && !TOOL_RESULT.test(line.text)) {
      segments.push({ kind: 'line', line });
      continue;
    }
    let last = segments.at(-1);
    if (last?.kind !== 'tools') {
      last = { kind: 'tools', lines: [], tools: [] };
      segments.push(last);
    }
    last.lines.push(line);
    if (call) last.tools.push(call[1]);
  }
  return segments;
};
