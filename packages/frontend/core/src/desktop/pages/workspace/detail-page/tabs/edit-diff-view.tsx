import clsx from 'clsx';
import { useMemo, useState } from 'react';

import {
  type DiffRow,
  type DiffSpan,
  diffLines,
  type EditPreview,
  type FileEdit,
} from './edit-diff';
import * as styles from './edit-diff.css';

/** Unchanged lines kept around each change; longer runs fold away. */
const CONTEXT = 3;

type Block =
  | { kind: 'rows'; rows: DiffRow[] }
  | { kind: 'fold'; rows: DiffRow[] };

/** Splits long runs of unchanged rows out so they can be folded. */
const foldUnchanged = (rows: DiffRow[]): Block[] => {
  const blocks: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      let j = i;
      while (j < rows.length && rows[j].kind !== 'same') j++;
      blocks.push({ kind: 'rows', rows: rows.slice(i, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const run = rows.slice(i, j);
    const keepHead = i === 0 ? 0 : CONTEXT;
    const keepTail = j === rows.length ? 0 : CONTEXT;
    if (run.length > keepHead + keepTail + 1) {
      if (keepHead) blocks.push({ kind: 'rows', rows: run.slice(0, keepHead) });
      blocks.push({
        kind: 'fold',
        rows: run.slice(keepHead, run.length - keepTail),
      });
      if (keepTail) blocks.push({ kind: 'rows', rows: run.slice(-keepTail) });
    } else {
      blocks.push({ kind: 'rows', rows: run });
    }
    i = j;
  }
  return blocks;
};

const Spans = ({
  spans,
  wordClass,
}: {
  spans: DiffSpan[];
  wordClass: string;
}) => (
  <>
    {spans.map((span, i) =>
      span.changed && span.text.trim() ? (
        <span key={i} className={wordClass}>
          {span.text}
        </span>
      ) : (
        <span key={i}>{span.text}</span>
      )
    )}
    {/* Keep an empty line one line tall. */}
    {spans.every(s => !s.text) ? '​' : null}
  </>
);

const Row = ({ row, single }: { row: DiffRow; single: boolean }) => {
  // A whole-line change only needs its line tinted, not every word marked.
  const wholeLine = row.kind === 'added' || row.kind === 'removed';
  const left =
    row.left === null ? (
      <div className={clsx(styles.cell, styles.cellEmpty)} />
    ) : (
      <div
        className={clsx(styles.cell, row.kind !== 'same' && styles.cellRemoved)}
      >
        <Spans
          spans={row.left}
          wordClass={wholeLine ? '' : styles.wordRemoved}
        />
      </div>
    );
  const right =
    row.right === null ? (
      <div className={clsx(styles.cell, styles.cellEmpty)} />
    ) : (
      <div
        className={clsx(styles.cell, row.kind !== 'same' && styles.cellAdded)}
      >
        <Spans
          spans={row.right}
          wordClass={wholeLine ? '' : styles.wordAdded}
        />
      </div>
    );
  return (
    <div className={single ? styles.singleRow : styles.row}>
      {single ? null : left}
      {right}
    </div>
  );
};

const Fold = ({ rows, single }: { rows: DiffRow[]; single: boolean }) => {
  const [open, setOpen] = useState(false);
  if (open) {
    return rows.map((row, i) => <Row key={i} row={row} single={single} />);
  }
  return (
    <button type="button" className={styles.fold} onClick={() => setOpen(true)}>
      ⋯ {rows.length} unchanged lines
    </button>
  );
};

const FileDiff = ({ edit }: { edit: FileEdit }) => {
  // A new file has nothing on the left; show it as one column of additions.
  const single = edit.before === null;
  const rows = useMemo(
    () => diffLines(edit.before ?? '', edit.after),
    [edit.before, edit.after]
  );
  const blocks = useMemo(() => foldUnchanged(rows), [rows]);
  const added = rows.filter(r => r.kind !== 'same' && r.right).length;
  const removed = single
    ? 0
    : rows.filter(r => r.kind !== 'same' && r.left).length;

  return (
    <div className={styles.file} data-testid="agent-edit-diff">
      <div className={styles.fileHeader}>
        <span className={styles.path} title={edit.path}>
          {/* rtl so a long path clips at the start, keeping the file name */}
          <bdi>{edit.path || 'file'}</bdi>
        </span>
        <span className={styles.stats}>
          {single ? 'new file ' : null}
          <span className={styles.added}>+{added}</span>{' '}
          {single ? null : <span className={styles.removed}>−{removed}</span>}
        </span>
      </div>
      <div className={styles.body}>
        {single ? null : (
          <div className={styles.columnsHeader}>
            <span>Before</span>
            <span>After</span>
          </div>
        )}
        {blocks.map((block, i) =>
          block.kind === 'fold' ? (
            <Fold key={i} rows={block.rows} single={single} />
          ) : (
            block.rows.map((row, j) => (
              <Row key={`${i}-${j}`} row={row} single={single} />
            ))
          )
        )}
      </div>
    </div>
  );
};

/** Before/after view of the file edits an agent wants permission for. */
export const EditDiffView = ({ preview }: { preview: EditPreview }) => (
  <div className={styles.diff}>
    {preview.edits.map((edit, i) => (
      <FileDiff key={i} edit={edit} />
    ))}
  </div>
);
