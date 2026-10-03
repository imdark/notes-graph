import { Button, notify } from '@notesgraph/component';
import { parseLogLines } from '@notesgraph/core/modules/agents';
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as styles from './agents.css';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const clockTime = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const elapsed = (ms: number) => {
  const secs = Math.max(0, ms) / 1000;
  const mins = Math.floor(secs / 60);
  return `+${mins}:${pad(Math.floor(secs % 60))}.${Math.floor((secs * 10) % 10)}`;
};

/** A selected span of lines, by 1-based line number, inclusive. */
interface LineRange {
  from: number;
  to: number;
}

/**
 * A run's transcript as numbered lines.
 *
 * Lines don't wrap — tool output is often a table or a path that only reads
 * on one line — so the body scrolls sideways while the gutter stays put.
 * Clicking a line number selects that line (Shift-click selects a range) to
 * copy; clicking a time switches every line between the clock and the time
 * since the run's first line.
 */
export const AgentLogView = ({
  log,
  placeholder,
  resetKey,
}: {
  log: string;
  /** Shown when there are no lines yet. */
  placeholder: string;
  /** Changes when a different run is shown; resets scroll and selection. */
  resetKey: string | null;
}) => {
  const lines = useMemo(() => parseLogLines(log), [log]);
  const hasTimes = useMemo(() => lines.some(line => line.at !== null), [lines]);
  const startAt = useMemo(
    () => lines.find(line => line.at !== null)?.at ?? null,
    [lines]
  );

  const [relative, setRelative] = useState(false);
  const [selected, setSelected] = useState<LineRange | null>(null);
  const anchor = useRef<number | null>(null);

  // Follow the end of the log while the reader is at the end; once they
  // scroll up, or pick a line, stop yanking them back down.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    stickToEnd.current = true;
    anchor.current = null;
    setSelected(null);
  }, [resetKey]);

  const onLineNumber = useCallback((e: MouseEvent, number: number) => {
    stickToEnd.current = false;
    if (e.shiftKey && anchor.current !== null) {
      const a = anchor.current;
      setSelected({ from: Math.min(a, number), to: Math.max(a, number) });
      return;
    }
    anchor.current = number;
    setSelected(prev =>
      prev && prev.from === number && prev.to === number
        ? null
        : { from: number, to: number }
    );
  }, []);

  const toggleTimes = useCallback(() => setRelative(prev => !prev), []);

  const copySelected = useCallback(() => {
    if (!selected) return;
    const text = lines
      .slice(selected.from - 1, selected.to)
      .map(line => line.text)
      .join('\n');
    navigator.clipboard
      .writeText(text)
      .then(() => notify.success({ title: 'Copied' }))
      .catch(() => notify.error({ title: "Couldn't copy" }));
  }, [lines, selected]);

  const numberWidth = String(lines.length).length;

  return (
    <div className={styles.logView}>
      {selected ? (
        <div className={styles.logToolbar}>
          <span className={styles.hint}>
            {selected.from === selected.to
              ? `Line ${selected.from}`
              : `Lines ${selected.from}–${selected.to}`}
          </span>
          <Button onClick={copySelected}>
            Copy
          </Button>
          <Button variant="plain" onClick={() => setSelected(null)}>
            Clear
          </Button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={styles.logScroll}
        data-testid="agent-run-log-text"
      >
        {lines.length === 0 ? (
          <div className={styles.logPlaceholder}>{placeholder}</div>
        ) : (
          <div className={styles.logLines}>
            {lines.map(line => {
              const isSelected =
                !!selected &&
                line.number >= selected.from &&
                line.number <= selected.to;
              return (
                <div
                  key={line.number}
                  className={styles.logLine}
                  data-selected={isSelected || undefined}
                >
                  <span className={styles.logGutter}>
                    <button
                      className={styles.logLineNumber}
                      style={{ minWidth: `${numberWidth + 1}ch` }}
                      onClick={e => onLineNumber(e, line.number)}
                      title="Select line (Shift-click for a range)"
                      data-testid="agent-log-line-number"
                    >
                      {line.number}
                    </button>
                    {hasTimes ? (
                      line.at !== null ? (
                        <button
                          className={styles.logTime}
                          onClick={toggleTimes}
                          title={`${new Date(line.at).toLocaleString()} — click to show ${relative ? 'clock time' : 'time since start'}`}
                          data-testid="agent-log-time"
                        >
                          {relative && startAt !== null
                            ? elapsed(line.at - startAt)
                            : clockTime(line.at)}
                        </button>
                      ) : (
                        <span className={styles.logTime} />
                      )
                    ) : null}
                  </span>
                  <span className={styles.logLineText}>{line.text || ' '}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
