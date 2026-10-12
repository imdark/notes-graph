import { logBuffer, type LogLevel } from '@notesgraph/core/bootstrap/log-buffer';
import { useState, useSyncExternalStore } from 'react';

const COLORS: Record<LogLevel, string> = {
  log: 'inherit',
  info: '#1e6fd9',
  warn: '#b26a00',
  error: '#d1242f',
};

export const Component = () => {
  const entries = useSyncExternalStore(
    logBuffer.subscribe,
    logBuffer.getSnapshot
  );
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const shown = (
    level === 'all' ? entries : entries.filter(e => e.level === level)
  )
    .slice()
    .reverse();

  return (
    <div style={{ padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select
          aria-label="Log level"
          value={level}
          onChange={e => setLevel(e.target.value as LogLevel | 'all')}
        >
          {['all', 'log', 'info', 'warn', 'error'].map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => logBuffer.clear()}>
          Clear
        </button>
        <span>{shown.length} entries</span>
      </div>
      {shown.map(e => (
        <div
          key={e.id}
          style={{
            color: COLORS[e.level],
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            borderBottom: '1px solid #8883',
            padding: '4px 0',
          }}
        >
          {new Date(e.time).toLocaleTimeString()} [{e.level}] {e.message}
        </div>
      ))}
    </div>
  );
};
