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
import { useAISpecs } from '@notesgraph/core/components/hooks/notesgraph/use-ai-specs';
import {
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
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

/** A file sent with a question. Its text rides inside the message. */
interface AttachedFile {
  name: string;
  text: string;
}

/** A shown turn; the files are listed under the question they came with. */
type Turn = ChatMessage & { files?: string[] };

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
 * server.
 */
export const AgentSideChat = ({
  title,
  hint,
  placeholder,
  opening,
  renderReply = renderFormattedReply,
  openModel,
  onClose,
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
  onClose?: () => void;
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

  const model = useRef<ChatModel | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);

  const start = useCallback(async (): Promise<ChatModel> => {
    if (model.current) return model.current;
    history.current = await opening();
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
      setBusy(true);
      setError(null);
      setText('');
      setFiles([]);
      setTurns(prev => [
        ...prev,
        {
          role: 'user',
          content: message,
          files: attached.map(file => file.name),
        },
        { role: 'assistant', content: '' },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const chat = await start();
        history.current = [
          ...history.current,
          { role: 'user', content: withFiles(message, attached) },
        ];
        let reply = '';
        // A long reply streams in many small chunks; one render per frame
        // keeps the page responsive instead of one per chunk.
        let frame = 0;
        const show = () => {
          frame = 0;
          const content = reply;
          setTurns(prev => [
            ...prev.slice(0, -1),
            { role: 'assistant', content },
          ]);
        };
        try {
          for await (const delta of chat(history.current, controller.signal)) {
            reply += delta;
            if (!frame) frame = requestAnimationFrame(show);
          }
        } finally {
          if (frame) cancelAnimationFrame(frame);
        }
        show();
        history.current = [
          ...history.current,
          { role: 'assistant', content: reply },
        ];
      } catch (err) {
        if (controller.signal.aborted) return;
        // Drop the empty reply; keep the question so it can be re-asked.
        setTurns(prev =>
          prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [start]
  );

  const canSend = (text.trim().length > 0 || files.length > 0) && !busy;
  const send = useCallback(() => {
    if (!canSend) return;
    ask(text.trim(), files).catch(() => {});
  }, [ask, canSend, files, text]);

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
      <div className={styles.forkPanel} data-testid={testId}>
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
        <span className={styles.hint}>{hint}</span>

        {turns.length > 0 ? (
          <div className={styles.forkMessages}>
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
              ) : (
                <div key={i} className={styles.forkReply}>
                  {renderReply(turn.content, busy && i === turns.length - 1)}
                </div>
              )
            )}
            <div ref={listEnd} />
          </div>
        ) : null}

        <div
          className={styles.chatComposer}
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
            disabled={busy}
            autoFocus
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
              onChange={e => {
                attach(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
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
