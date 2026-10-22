import {
  LitTextRenderer,
  type TextRendererOptions,
} from '@notesgraph/core/blocksuite/ai/components/text-renderer';
import { registerAISharedEffects } from '@notesgraph/core/blocksuite/ai/effects/shared';
import { useAISpecs } from '@notesgraph/core/components/hooks/notesgraph/use-ai-specs';
import {
  type AgentRun,
  changesAreEmpty,
  type PatchFile,
  parsePatch,
  type RunChanges,
} from '@notesgraph/core/modules/agents';
import { DocDisplayMetaService } from '@notesgraph/core/modules/doc-display-meta';
import { AppThemeService } from '@notesgraph/core/modules/theme';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './agents.css';
import * as diffStyles from './edit-diff.css';
import { EditDiffView } from './edit-diff-view';

// LitTextRenderer constructs <text-renderer>, which is otherwise only
// registered once an editor or the chat page has loaded.
registerAISharedEffects();

/**
 * Lines of a file's diff shown before "Show all": the diff grows to its
 * content, so only a very long one is held back.
 */
const FILE_LINES = 400;

/** Sections line their items up at the start; a diff takes the full width. */
const STRETCH = { alignItems: 'stretch' } as const;

const NoteLink = ({
  docId,
  fallback,
  onOpen,
}: {
  docId: string;
  fallback?: string;
  onOpen: (docId: string) => void;
}) => {
  const displayMeta = useService(DocDisplayMetaService);
  const title = useLiveData(
    useMemo(() => displayMeta.title$(docId), [displayMeta, docId])
  );
  return (
    <button
      className={styles.linkButton}
      onClick={() => onOpen(docId)}
      title="Open the note"
      data-testid="agent-changes-note"
    >
      {title || fallback || 'Untitled'}
    </button>
  );
};

const lineClass = (kind: string) =>
  kind === 'added'
    ? `${diffStyles.cell} ${diffStyles.cellAdded}`
    : kind === 'removed'
      ? `${diffStyles.cell} ${diffStyles.cellRemoved}`
      : diffStyles.cell;

/** One file of the git diff: its +/- counts, then its hunks. */
const PatchFileView = ({
  file,
  stat,
}: {
  file: PatchFile;
  stat?: { added: number; removed: number };
}) => {
  const [all, setAll] = useState(false);
  const rows = file.hunks.flatMap(hunk => [
    { key: hunk.header, header: hunk.header },
    ...hunk.lines.map((line, i) => ({ key: `${hunk.header}:${i}`, line })),
  ]);
  const shown = all ? rows : rows.slice(0, FILE_LINES);
  return (
    <div className={diffStyles.file} data-testid="agent-changes-file">
      <div className={diffStyles.fileHeader}>
        <span className={diffStyles.path} title={file.path}>
          {file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <span className={diffStyles.stats}>
          {file.status === 'added' ? 'new · ' : file.status === 'deleted' ? 'deleted · ' : ''}
          {stat ? (
            <>
              <span className={diffStyles.added}>+{stat.added}</span>{' '}
              <span className={diffStyles.removed}>−{stat.removed}</span>
            </>
          ) : null}
        </span>
      </div>
      {file.status === 'binary' ? (
        <div className={styles.hint} style={{ padding: '4px 8px' }}>
          Binary file
        </div>
      ) : (
        <div className={diffStyles.bodyFull}>
          <div className={diffStyles.lines}>
            {shown.map(row =>
              'header' in row ? (
                <div key={row.key} className={diffStyles.fold}>
                  <span className={diffStyles.foldLabel}>{row.header}</span>
                </div>
              ) : (
                <div key={row.key} className={diffStyles.singleRow}>
                  <span className={lineClass(row.line.kind)}>
                    {row.line.text || ' '}
                  </span>
                </div>
              )
            )}
            {rows.length > shown.length ? (
              <button className={diffStyles.fold} onClick={() => setAll(true)}>
                <span className={diffStyles.foldLabel}>
                  Show all {rows.length} lines
                </span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

const GitChanges = ({ git }: { git: NonNullable<RunChanges['git']> }) => {
  const files = useMemo(() => parsePatch(git.patch), [git.patch]);
  const stats = useMemo(
    () => new Map(git.stat.map(s => [s.path, s])),
    [git.stat]
  );
  const added = git.stat.reduce((sum, s) => sum + s.added, 0);
  const removed = git.stat.reduce((sum, s) => sum + s.removed, 0);
  // Files the patch lost to the size cap are still in the stat.
  const unshown = git.stat.filter(s => !files.some(f => f.path === s.path));

  return (
    <>
      {git.commits.length > 0 ? (
        <div className={styles.section} data-testid="agent-changes-commits">
          <span className={styles.sectionLabel}>
            Commits ({git.commits.length})
            {git.branch ? ` on ${git.branch}` : ''}
          </span>
          {git.commits.map(commit => (
            <span key={commit.sha} className={styles.hint}>
              <code>{commit.sha}</code> {commit.subject}
            </span>
          ))}
        </div>
      ) : null}
      {git.stat.length > 0 || files.length > 0 ? (
        <div className={styles.section} style={STRETCH}>
          <span className={styles.sectionLabel}>
            Files changed ({Math.max(git.stat.length, files.length)}){' '}
            <span className={diffStyles.added}>+{added}</span>{' '}
            <span className={diffStyles.removed}>−{removed}</span>
          </span>
          <div className={diffStyles.diff}>
            {files.map(file => (
              <PatchFileView
                key={file.path}
                file={file}
                stat={stats.get(file.path)}
              />
            ))}
          </div>
          {unshown.length > 0 ? (
            <span className={styles.hint}>
              Also changed, diff too large to keep:{' '}
              {unshown.map(s => `${s.path} (+${s.added} −${s.removed})`).join(', ')}
            </span>
          ) : null}
          {git.truncated ? (
            <span className={styles.hint}>
              The diff was cut to fit; the commits on the branch have all of it.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
};

/**
 * What a finished run did: its answer, the notes it created (a research run's
 * result), the notes it edited or linked, and what it changed in the project
 * — commits and the diff when it worked in a git checkout, else each file
 * edit it made.
 */
export const AgentRunChanges = ({
  run,
  summary,
  changes,
  loading,
  onClose,
}: {
  run: AgentRun;
  summary: string | null;
  /** Null: nothing recorded. Undefined: this run doesn't record changes. */
  changes: RunChanges | null | undefined;
  loading: boolean;
  /** Closes the dialog, so an opened note isn't hidden behind it. */
  onClose: () => void;
}) => {
  const workbench = useService(WorkbenchService).workbench;
  const themeService = useService(AppThemeService);
  const specs = useAISpecs();
  // The answer is Markdown; render it as the AI chat does.
  const markdownOptions = useMemo<TextRendererOptions>(
    () => ({
      customHeading: true,
      extensions: specs,
      theme: themeService.appTheme.themeSignal,
      scrollable: false,
    }),
    [specs, themeService]
  );
  const openNote = useCallback(
    (docId: string) => {
      onClose();
      workbench.openDoc(docId, { at: 'active' });
    },
    [onClose, workbench]
  );

  const notes = changes?.notes;
  const created = notes?.created ?? [];
  const edited = notes?.edited ?? [];
  const linked = notes?.linked ?? [];
  const files = changes?.files ?? [];
  const git = changes?.git;
  // With a git diff the recorded edits say the same thing, less exactly.
  const showFileEdits = files.length > 0 && !git?.patch;

  return (
    <div className={styles.changesScroll} data-testid="agent-run-changes">
      <div className={styles.section} style={STRETCH}>
        <span className={styles.sectionLabel}>Summary</span>
        {run.status === 'error' && run.error ? (
          <p className={styles.error}>{run.error}</p>
        ) : null}
        <div className={styles.forkReplyText} data-testid="agent-changes-summary">
          {summary?.trim() ? (
            <LitTextRenderer
              answer={summary.trim()}
              options={markdownOptions}
              state="finished"
            />
          ) : (
            <p className={styles.output}>
              It finished without saying what it did.
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <p className={styles.empty}>Loading what it changed…</p>
      ) : changes === undefined ? (
        <p className={styles.empty}>
          This run didn't record what it changed. Runs on a device or in the
          cloud do; the log shows what this one did.
        </p>
      ) : changesAreEmpty(changes) ? (
        <p className={styles.empty} data-testid="agent-changes-none">
          {changes === null
            ? 'No record of what it changed: it ran before runs recorded their changes, or on a runner that does not yet. The log shows what it did.'
            : 'It changed no notes or files.'}
        </p>
      ) : null}

      {created.length > 0 ? (
        <div className={styles.section} data-testid="agent-changes-created">
          <span className={styles.sectionLabel}>
            Notes it created ({created.length})
          </span>
          {created.map(note => (
            <NoteLink
              key={note.docId}
              docId={note.docId}
              fallback={note.title}
              onOpen={openNote}
            />
          ))}
        </div>
      ) : null}

      {edited.length > 0 ? (
        <div className={styles.section} data-testid="agent-changes-edited">
          <span className={styles.sectionLabel}>
            Notes it edited ({edited.length})
          </span>
          {edited.map(note => (
            <NoteLink
              key={note.docId}
              docId={note.docId}
              fallback={note.title}
              onOpen={openNote}
            />
          ))}
        </div>
      ) : null}

      {linked.length > 0 ? (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Links it added</span>
          {linked.map(link => (
            <span
              key={`${link.parentDocId}>${link.childDocId}`}
              className={styles.hint}
            >
              <NoteLink docId={link.parentDocId} onOpen={openNote} /> →{' '}
              <NoteLink docId={link.childDocId} onOpen={openNote} />
            </span>
          ))}
        </div>
      ) : null}

      {git ? <GitChanges git={git} /> : null}

      {showFileEdits ? (
        <div
          className={styles.section}
          style={STRETCH}
          data-testid="agent-changes-edits"
        >
          <span className={styles.sectionLabel}>
            File edits ({files.length})
          </span>
          <EditDiffView
            full
            preview={{
              tool: 'Edit',
              edits: files.map(file => ({
                path: file.path,
                before: file.before,
                after: file.after ?? '',
              })),
            }}
          />
        </div>
      ) : null}
      {changes?.filesDropped ? (
        <span className={styles.hint}>
          Its file edits were too large to keep; the log lists them.
        </span>
      ) : null}
    </div>
  );
};
