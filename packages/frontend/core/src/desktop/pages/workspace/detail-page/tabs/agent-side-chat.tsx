import {
  ArrowUpBigIcon,
  AttachmentIcon,
  CloseIcon,
  FileIcon,
} from '@blocksuite/icons/rc';
import {
  LitTextRenderer,
  type TextRendererOptions,
} from '@notesgraph/core/blocksuite/ai/components/text-renderer';
import { registerAISharedEffects } from '@notesgraph/core/blocksuite/ai/effects/shared';
import { useAISpecs } from '@notesgraph/core/components/hooks/notesgraph/use-ai-specs';
import {
  type AskTurnState,
  AskTurnsService,
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
  LiveAskTurn,
  type SavedAskChat,
} from '@notesgraph/core/modules/agents';
import { AppThemeService } from '@notesgraph/core/modules/theme';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import {
  type ClipboardEvent,
  createContext,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as styles from './agents.css';

// LitTextRenderer constructs <text-renderer>, which is otherwise only
// registered once an editor or the chat page has loaded.
registerAISharedEffects();

/** A file sent with a question. Its text rides inside the message. */
interface AttachedFile {
  name: string;
  text: string;
}

/** A shown turn; the files are listed under the question they came with. */
type Turn = SavedAskChat['turns'][number];

/** How a turn ended, for a chat that is recorded. */
export type SideChatOutcome =
  | { status: 'done' }
  | { status: 'error'; error: string }
  | { status: 'cancelled' };

/**
 * Where a chat is kept, so it can be found and gone on with later. The chat
 * calls it; what is stored, and where, is the caller's.
 */
export interface SideChatRecord {
  /**
   * Which chat this is, once it has one (read after `asking`). With it, a
   * reply goes on when the panel closes, ends in the record as it would have
   * with the panel open, and is shown again, still coming, when a panel opens
   * on the same chat. Without it, closing the panel stops the reply.
   */
  key?: () => string | null;
  /** A chat kept earlier, shown and continued; null to start afresh. */
  load: () => Promise<SavedAskChat | null>;
  /** A question was sent. */
  asking: () => void;
  /** A turn ended: the chat as it now stands, and the turn's own turns. */
  ended: (
    chat: SavedAskChat,
    turn: SavedAskChat['turns'],
    outcome: SideChatOutcome
  ) => void;
}

/**
 * A second way to send what is typed: not asked of the chat but handed to a
 * new run that carries on the work (see AgentRunChat).
 */
export interface SideChatFollowUp {
  /** The button's text. */
  label: string;
  /** What pressing it does, for its tooltip. */
  title: string;
  /**
   * Start the run with the message (files inlined) and the chat so far;
   * resolves to what to show in the chat once it has started.
   */
  start: (message: string, chat: SavedAskChat['turns']) => Promise<string>;
}

/**
 * The models behind a side chat (a device's Claude Code, the local model,
 * the server's) all take text, so a file is read here and sent as text.
 */
const MAX_FILE_BYTES = 200_000;

async function readAttachment(file: File): Promise<AttachedFile> {
  if (file.type.startsWith('image/')) {
    throw new Error(
      `${file.name} is an image. This chat can only read text files: logs, code, Markdown, JSON, CSV.`
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `${file.name} is ${Math.round(file.size / 1000)} KB; files up to ${MAX_FILE_BYTES / 1000} KB can be sent.`
    );
  }
  const text = await file.text();
  // A NUL byte means it is not text (a PDF, an archive, …).
  if (text.includes('\0')) {
    throw new Error(
      `${file.name} isn't a text file. This chat can only read text files.`
    );
  }
  return { name: file.name, text };
}

function withFiles(message: string, files: AttachedFile[]): string {
  if (!files.length) return message;
  const attached = files
    .map(file => `<file name="${file.name}">\n${file.text}\n</file>`)
    .join('\n\n');
  return message ? `${message}\n\n${attached}` : attached;
}

const ReplyOptions = createContext<TextRendererOptions | null>(null);

/**
 * A reply rendered as the main AI chat renders one: Markdown with headings,
 * lists, code blocks and tables.
 */
export const ChatReplyText = ({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) => {
  const options = useContext(ReplyOptions);
  if (!text) return <p className={styles.output}>…</p>;
  if (!options) return <p className={styles.output}>{text}</p>;
  return (
    <div className={styles.forkReplyText}>
      <LitTextRenderer
        answer={text}
        options={options}
        state={streaming ? 'generating' : 'finished'}
      />
    </div>
  );
};

const renderFormattedReply = (reply: string, streaming: boolean) => (
  <ChatReplyText text={reply} streaming={streaming} />
);

/**
 * A chat about a run, seeded with the run's context:
 * the question fork beside a question a run is waiting on, and the chat about
 * a run that has ended. Neither reaches the run itself.
 *
 * It looks and works like the main AI chat panel: formatted replies, and
 * files can be attached with the button, pasted or dropped on the box.
 *
 * The model conversation and its opening are made lazily, on the first
 * message, so opening the panel and closing it again costs nothing on the
 * server. A recorded chat's reply is answered in AskTurnsService rather than
 * in the panel, so closing the panel mid-answer doesn't stop it.
 */
export const AgentSideChat = ({
  title,
  hint,
  placeholder,
  opening,
  renderReply = renderFormattedReply,
  openModel,
  record,
  followUp,
  waiting,
  onClose,
  fill,
  testId,
}: {
  title: string;
  hint: string;
  placeholder: string;
  /** The conversation's opening: what it is for and what it knows. */
  opening: () => Promise<ChatMessage[]>;
  renderReply?: (reply: string, streaming: boolean) => ReactNode;
  /** Who answers; the server's model when not given. */
  openModel?: () => Promise<ChatModel>;
  /** Keep the chat; without it, it is gone once the panel closes. */
  record?: SideChatRecord;
  /** Send what is typed to a new run instead; see SideChatFollowUp. */
  followUp?: SideChatFollowUp;
  /** Why the reply hasn't started, shown under it while it is awaited. */
  waiting?: string | null;
  onClose?: () => void;
  /**
   * Fill the space it is given instead of sitting in a bordered box: the
   * transcript scrolls and the composer stays at the bottom, as on a phone.
   */
  fill?: boolean;
  testId: string;
}) => {
  const cloudRunner = useService(CloudAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const themeService = useService(AppThemeService);
  const specs = useAISpecs();
  const replyOptions = useMemo<TextRendererOptions>(
    () => ({
      customHeading: true,
      extensions: specs,
      theme: themeService.appTheme.themeSignal,
      scrollable: false,
    }),
    [specs, themeService]
  );

  // Shown turns only; the opening context lives in `history` alone.
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A kept chat is shown before anything more can be asked.
  const [loaded, setLoaded] = useState(!record);

  const model = useRef<ChatModel | null>(null);
  // The model is sent the opening, then everything since.
  const opened = useRef<ChatMessage[]>([]);
  const sent = useRef<ChatMessage[]>([]);
  // The shown turns as of the last ended turn, without a reply in progress.
  const shown = useRef<Turn[]>([]);
  const recordRef = useRef(record);
  recordRef.current = record;
  const askTurns = useService(AskTurnsService);
  // The turn shown as it is answered, and whether it outlives the panel.
  const live = useRef<{
    turn: LiveAskTurn;
    kept: boolean;
    unwatch: () => void;
  } | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const watch = useCallback((turn: LiveAskTurn, kept: boolean) => {
    live.current?.unwatch();
    const apply = (state: AskTurnState) => {
      setTurns(state.turns);
      setBusy(state.busy);
      if (state.busy) return;
      shown.current = state.turns;
      sent.current = state.history;
      if (live.current?.turn === turn) {
        live.current.unwatch();
        live.current = null;
      }
    };
    live.current = { turn, kept, unwatch: turn.subscribe(apply) };
    apply(turn.state);
  }, []);

  useEffect(
    () => () => {
      const current = live.current;
      live.current = null;
      current?.unwatch();
      // A kept chat's reply goes on without the panel; any other is for no one.
      if (current && !current.kept) current.turn.cancel();
    },
    []
  );
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);
  // The keyboard takes a moment to open and shrink the chat; once it has,
  // bring the latest message back into view above the composer.
  const onInputFocus = useCallback(() => {
    if (!fill) return;
    setTimeout(() => listEnd.current?.scrollIntoView({ block: 'end' }), 300);
  }, [fill]);

  useEffect(() => {
    const kept = recordRef.current;
    if (!kept) return;
    // Closed while answering and opened again: the reply is still coming.
    const key = kept.key?.();
    const going = key ? askTurns.get(key) : undefined;
    if (going) {
      watch(going, true);
      setLoaded(true);
      return;
    }
    let mounted = true;
    kept
      .load()
      .then(saved => {
        if (!mounted || !saved) return;
        shown.current = saved.turns;
        sent.current = saved.history;
        setTurns(saved.turns);
      })
      // Unreadable: start afresh rather than not at all.
      .catch(() => {})
      .finally(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, [askTurns, watch]);

  const start = useCallback(async (): Promise<ChatModel> => {
    if (model.current) return model.current;
    opened.current = await opening();
    model.current = openModel
      ? await openModel()
      : await cloudRunner.open(workspaceService.workspace.id);
    return model.current;
  }, [cloudRunner, opening, openModel, workspaceService]);

  const attach = useCallback((picked: File[]) => {
    if (!picked.length) return;
    setError(null);
    Promise.allSettled(picked.map(readAttachment))
      .then(results => {
        const read = results.flatMap(r =>
          r.status === 'fulfilled' ? [r.value] : []
        );
        const failed = results.flatMap(r =>
          r.status === 'rejected'
            ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
            : []
        );
        if (read.length) setFiles(prev => [...prev, ...read]);
        if (failed.length) setError(failed.join(' '));
      })
      .catch(() => {});
  }, []);

  const ask = useCallback(
    async (message: string, attached: AttachedFile[]) => {
      setError(null);
      setText('');
      setFiles([]);
      const question: Turn = {
        role: 'user',
        content: message,
        files: attached.map(file => file.name),
        at: Date.now(),
      };
      const before = shown.current;
      let history = sent.current;
      // Read once: the panel may close, and its record change, mid-answer.
      const record = recordRef.current;
      record?.asking();
      const key = record?.key?.() ?? null;
      const asked = {
        turns: [
          ...before,
          question,
          { role: 'assistant' as const, content: '' },
        ],
        history,
      };
      const turn = key
        ? askTurns.begin(key, asked)
        : new LiveAskTurn({ ...asked, busy: true });
      watch(turn, !!key);
      const controller = turn.controller;
      let reply = '';
      // Keep the question, and the reply if any came; then tell the record.
      const end = (outcome: SideChatOutcome) => {
        const answer: Turn[] = reply
          ? [{ role: 'assistant', content: reply, at: Date.now() }]
          : [];
        // A failure is kept where the answer would be, so it is still in the
        // chat when it is opened again.
        const failure: Turn[] =
          outcome.status === 'error'
            ? [
                {
                  role: 'assistant',
                  content: outcome.error,
                  at: Date.now(),
                  error: true,
                },
              ]
            : [];
        // The error takes the empty reply's place in the chat; the question
        // stays above it, to be asked again.
        const chat = {
          turns: [...before, question, ...answer, ...failure],
          history,
        };
        // The record first, so a panel that opens on it as the turn ends
        // reads the turn there rather than an answer still coming.
        record?.ended(chat, [question, ...answer], outcome);
        turn.end(chat);
      };
      try {
        const chat = await start();
        history = [
          ...history,
          { role: 'user', content: withFiles(message, attached) },
        ];
        // A long reply streams in many small chunks; one render per frame
        // keeps the page responsive instead of one per chunk.
        let frame = 0;
        const show = () => {
          frame = 0;
          turn.update({
            turns: [...before, question, { role: 'assistant', content: reply }],
          });
        };
        try {
          for await (const delta of chat(
            [...opened.current, ...history],
            controller.signal
          )) {
            reply += delta;
            if (!frame) frame = requestAnimationFrame(show);
          }
        } finally {
          if (frame) cancelAnimationFrame(frame);
        }
        show();
        history = [...history, { role: 'assistant', content: reply }];
        end({ status: 'done' });
      } catch (err) {
        if (controller.signal.aborted) {
          end({ status: 'cancelled' });
          return;
        }
        end({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [askTurns, start, watch]
  );

  const canSend =
    (text.trim().length > 0 || files.length > 0) && !busy && loaded;
  const send = useCallback(() => {
    if (!canSend) return;
    ask(text.trim(), files).catch(() => {});
  }, [ask, canSend, files, text]);

  // Nothing typed is fine: the run then just finishes what was left.
  const canContinue = !!followUp && !busy && loaded;
  const continueRun = useCallback(async () => {
    if (!followUp || !canContinue) return;
    const message = text.trim();
    const attached = files;
    setBusy(true);
    setError(null);
    const before = shown.current;
    const question: Turn = {
      role: 'user',
      content: message || 'Continue the run.',
      files: attached.map(file => file.name),
      at: Date.now(),
    };
    try {
      const note = await followUp.start(
        withFiles(message, attached),
        // A failed turn's error is not something that was said about the run.
        before.filter(turn => !turn.error)
      );
      setText('');
      setFiles([]);
      const answer: Turn = { role: 'assistant', content: note, at: Date.now() };
      shown.current = [...before, question, answer];
      setTurns(shown.current);
      // Kept as a turn, so the chat's record says the run was continued.
      recordRef.current?.asking();
      recordRef.current?.ended(
        { turns: shown.current, history: sent.current },
        [question, answer],
        { status: 'done' }
      );
    } catch (err) {
      // What was typed stays, to try again.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canContinue, files, followUp, text]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = Array.from(e.clipboardData.files);
      if (!pasted.length) return;
      e.preventDefault();
      attach(pasted);
    },
    [attach]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      attach(Array.from(e.dataTransfer.files));
    },
    [attach]
  );

  return (
    <ReplyOptions.Provider value={replyOptions}>
      <div
        className={fill ? styles.chatFill : styles.forkPanel}
        data-testid={testId}
      >
        {fill ? null : (
          <div className={styles.forkHead}>
            <span className={styles.questionLabel}>{title}</span>
            {onClose ? (
              <button
                className={styles.linkButton}
                onClick={onClose}
                data-testid={`${testId}-close`}
              >
                Close
              </button>
            ) : null}
          </div>
        )}
        {fill && turns.length > 0 ? null : (
          <span className={styles.hint}>{hint}</span>
        )}

        {turns.length > 0 ? (
          <div className={fill ? styles.chatFillMessages : styles.forkMessages}>
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className={styles.forkReply}>
                  {turn.content ? (
                    <p className={styles.forkUser}>{turn.content}</p>
                  ) : null}
                  {turn.files?.length ? (
                    <div className={styles.forkUserFiles}>
                      {turn.files.map((name, j) => (
                        <span key={j} className={styles.chatChip}>
                          <FileIcon />
                          <span className={styles.chatChipName}>{name}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : turn.error ? (
                <p
                  key={i}
                  className={styles.error}
                  role="alert"
                  data-testid={`${testId}-turn-error`}
                >
                  {turn.content}
                </p>
              ) : fill && !turn.content ? null : (
                <div key={i} className={styles.forkReply}>
                  {renderReply(turn.content, busy && i === turns.length - 1)}
                </div>
              )
            )}
            {fill && busy ? (
              <div
                className={styles.chatWorking}
                role="status"
                data-testid={`${testId}-working`}
              >
                <span className={styles.chatWorkingDots} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                Working on your answer
              </div>
            ) : null}
            {busy && waiting ? (
              <span className={styles.hint} data-testid={`${testId}-waiting`}>
                {waiting}
              </span>
            ) : null}
            <div ref={listEnd} />
          </div>
        ) : null}

        <div
          className={styles.chatComposer}
          data-fill={fill}
          data-dragging={dragging}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {files.length > 0 ? (
            <div className={styles.chatChips} data-testid={`${testId}-files`}>
              {files.map((file, i) => (
                <span key={i} className={styles.chatChip} title={file.name}>
                  <FileIcon />
                  <span className={styles.chatChipName}>{file.name}</span>
                  <button
                    className={styles.chatChipRemove}
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles(prev => prev.filter((_, j) => j !== i))
                    }
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            className={styles.chatComposerInput}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={2}
            onFocus={onInputFocus}
            disabled={busy}
            autoFocus={!fill}
            data-testid={`${testId}-input`}
          />
          <div className={styles.chatComposerActions}>
            <button
              className={styles.chatIconButton}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              aria-label="Attach a file"
              title="Attach a text file: a log, code, Markdown, JSON or CSV"
              data-testid={`${testId}-attach`}
            >
              <AttachmentIcon />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              // A global input style sets display, which beats `hidden`.
              style={{ display: 'none' }}
              onChange={e => {
                attach(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            {followUp ? (
              <button
                className={styles.chatContinueButton}
                aria-disabled={!canContinue}
                onClick={() => {
                  continueRun().catch(() => {});
                }}
                title={followUp.title}
                data-testid={`${testId}-continue`}
              >
                {followUp.label}
              </button>
            ) : null}
            <button
              className={styles.chatSendButton}
              aria-disabled={!canSend}
              aria-label={busy ? 'Thinking…' : 'Send'}
              onClick={send}
              data-testid={`${testId}-send`}
            >
              <ArrowUpBigIcon />
            </button>
          </div>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </ReplyOptions.Provider>
  );
};
