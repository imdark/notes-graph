import { nanoid } from 'nanoid';

import { CopilotClient } from '../../../blocksuite/ai/runtime/request/copilot-client';
import { AIRequestService } from '../../../blocksuite/ai/runtime/request/service';
import type { DocEmbedder } from './doc-embedder';
import type { LocalChatMessage, LocalLLMService } from './local-llm';
import { systemPromptFor } from './local-prompts';
import type { LocalVisionService } from './local-vision';

/**
 * RAG: if the workspace has a local index, retrieve the top chunks for the
 * latest user message and prepend them as context. Best-effort — returns the
 * messages unchanged (without loading the embedding model) when nothing is
 * indexed or retrieval fails.
 */
async function augmentWithContext(
  docEmbedder: DocEmbedder,
  messages: LocalChatMessage[]
): Promise<LocalChatMessage[]> {
  try {
    const { chunks } = await docEmbedder.store.stats();
    if (chunks === 0) return messages;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return messages;
    const query = messages[lastUserIdx].content;
    const results = await docEmbedder.search(query, 5);
    if (results.length === 0) return messages;
    const context = results
      .map((result, i) => `[${i + 1}] ${result.text}`)
      .join('\n\n');
    // Fold context into the user turn (not a new system message) — chat models
    // require a single system prompt as the first message.
    const augmented = [...messages];
    augmented[lastUserIdx] = {
      ...augmented[lastUserIdx],
      content: `Use these excerpts from my notes if relevant:\n\n${context}\n\n---\n\n${query}`,
    };
    return augmented;
  } catch {
    return messages;
  }
}

/**
 * A stand-in for the browser `EventSource` that streams a local model's tokens
 * in the SSE shape the AI text pipeline expects (see `toTextStream`):
 * `message` events carry tokens; a **data-less** `error` event signals normal
 * completion; an `error` event with JSON data is a real error.
 */
class LocalChatEventSource extends EventTarget {
  static readonly CLOSED = 2;
  readyState = 1;
  url = '';
  withCredentials = false;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onopen: ((ev: Event) => unknown) | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly llm: LocalLLMService,
    private readonly messages: LocalChatMessage[],
    private readonly docEmbedder?: DocEmbedder
  ) {
    super();
    this.run().catch(() => {
      /* errors are surfaced as `error` events */
    });
  }

  private async run() {
    let reply = '';
    try {
      // RAG: prepend relevant note excerpts (no-op if nothing is indexed).
      const messages = this.docEmbedder
        ? await augmentWithContext(this.docEmbedder, this.messages)
        : this.messages;
      for await (const token of this.llm.chatStream(messages, {
        signal: this.abort.signal,
      })) {
        if (this.readyState === LocalChatEventSource.CLOSED) return;
        reply += token;
        this.dispatchEvent(new MessageEvent('message', { data: token }));
      }
      // Keep the assistant turn so follow-up messages have context.
      this.messages.push({ role: 'assistant', content: reply });
      this.dispatchEvent(new Event('error'));
    } catch (err) {
      const data = JSON.stringify({
        status: 500,
        message: err instanceof Error ? err.message : 'Local AI error',
      });
      this.dispatchEvent(new MessageEvent('error', { data }));
    } finally {
      this.readyState = LocalChatEventSource.CLOSED;
    }
  }

  close() {
    this.readyState = LocalChatEventSource.CLOSED;
    this.abort.abort();
  }
}

/**
 * Drop-in replacement for the GraphQL {@link CopilotClient} that keeps chat
 * sessions in memory and generates from a local model — so chat + inline
 * actions work with no cloud calls. Only the methods the chat/action pipeline
 * needs are implemented; the rest return empty.
 */
export class LocalCopilotClient extends CopilotClient {
  private readonly sessions = new Map<string, LocalChatMessage[]>();
  private readonly contexts = new Map<
    string,
    { docs: Map<string, object>; files: Map<string, object> }
  >();

  constructor(
    private readonly llm: LocalLLMService,
    private readonly docEmbedder?: DocEmbedder,
    private readonly vision?: LocalVisionService
  ) {
    super(
      (() =>
        Promise.reject(
          new Error('Local AI: GraphQL is unavailable')
        )) as unknown as CopilotClient['gql'],
      (() => {
        throw new Error('Local AI: SSE is unavailable');
      }) as unknown as CopilotClient['eventSource'],
      undefined
    );
  }

  override async createSession(
    options: Parameters<CopilotClient['createSession']>[0]
  ): Promise<string> {
    const id = nanoid();
    const promptName = (options as { promptName?: string | null }).promptName;
    this.sessions.set(id, [
      { role: 'system', content: systemPromptFor(promptName) },
    ]);
    return id;
  }

  override async createSessionWithHistory(
    options: Parameters<CopilotClient['createSessionWithHistory']>[0]
  ): ReturnType<CopilotClient['createSessionWithHistory']> {
    const sessionId = await this.createSession(
      options as unknown as Parameters<CopilotClient['createSession']>[0]
    );
    return { sessionId } as unknown as Awaited<
      ReturnType<CopilotClient['createSessionWithHistory']>
    >;
  }

  override async createMessage(
    options: Parameters<CopilotClient['createMessage']>[0]
  ): Promise<string> {
    const messages = this.sessions.get(options.sessionId);
    let content = typeof options.content === 'string' ? options.content : '';
    // Parameterized actions (e.g. "Translate to", "Change tone to") carry the
    // target as params rather than in the text — surface it to the model.
    const params = (options as { params?: Record<string, unknown> }).params;
    if (params && typeof params === 'object') {
      const hint = Object.entries(params)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      if (hint) content = content ? `(${hint})\n${content}` : `(${hint})`;
    }
    // Image actions ("Explain this image") attach the image as blobs. The local
    // chat model is text-only, so caption the image on-device and fold the
    // description into the prompt. If captioning is unavailable or fails, leave
    // a clear note so the model tells the user instead of erroring on an empty
    // turn.
    const blobs = (options as { blobs?: Blob[] }).blobs;
    const vision = this.vision;
    if (blobs && blobs.length > 0) {
      let described = '';
      if (vision) {
        try {
          const captions = await Promise.all(
            blobs.map(blob => vision.caption(blob))
          );
          described = captions.filter(Boolean).join('; ');
        } catch {
          /* fall through to the graceful note below */
        }
      }
      const note = described
        ? `Image description: ${described}`
        : 'An image was attached, but on-device AI cannot analyze images. Briefly tell the user that image understanding needs Cloud AI (Settings → AI).';
      content = content ? `${content}\n\n${note}` : note;
    }
    if (messages && content) {
      messages.push({ role: 'user', content });
    }
    return nanoid();
  }

  override chatTextStream(
    options: Parameters<CopilotClient['chatTextStream']>[0]
  ): EventSource {
    const messages = this.sessions.get(options.sessionId) ?? [];
    return new LocalChatEventSource(
      this.llm,
      messages,
      this.docEmbedder
    ) as unknown as EventSource;
  }

  override async getHistories(): Promise<never[]> {
    return [];
  }
  override async getHistoryIds(): Promise<never[]> {
    return [];
  }
  override async getSessions(): Promise<never[]> {
    return [];
  }
  override async getRecentSessions(): Promise<never[]> {
    return [];
  }
  override async getEmbeddingStatus(): Promise<{
    total: number;
    embedded: number;
  }> {
    return { total: 0, embedded: 0 };
  }

  // Sessions live only in memory, so there is nothing to rebind to a doc or to
  // fetch back; the chat carries on with the session it already has.
  override async updateSession(
    options: Parameters<CopilotClient['updateSession']>[0]
  ): ReturnType<CopilotClient['updateSession']> {
    return options.sessionId as Awaited<
      ReturnType<CopilotClient['updateSession']>
    >;
  }
  override async getSession(): ReturnType<CopilotClient['getSession']> {
    return undefined as Awaited<ReturnType<CopilotClient['getSession']>>;
  }
  override async cleanupSessions(
    input: Parameters<CopilotClient['cleanupSessions']>[0]
  ): ReturnType<CopilotClient['cleanupSessions']> {
    for (const id of input.sessionIds) this.sessions.delete(id);
    return input.sessionIds as Awaited<
      ReturnType<CopilotClient['cleanupSessions']>
    >;
  }

  // Context (RAG) isn't available locally yet — degrade gracefully so adding a
  // doc/file as context is simply ignored instead of throwing a network error.
  // Added items are still listed back, as already embedded: the composer shows
  // a chip as loading (and holds the chat) until the context reports it done.
  override async getContextId(): Promise<undefined> {
    return undefined;
  }
  override async createContext(): ReturnType<CopilotClient['createContext']> {
    const id = nanoid();
    this.contexts.set(id, { docs: new Map(), files: new Map() });
    return id;
  }
  override async addContextDoc(options: {
    contextId: string;
    docId: string;
  }): ReturnType<CopilotClient['addContextDoc']> {
    const doc = {
      id: options.docId,
      status: 'finished',
      error: null,
      createdAt: Date.now(),
    };
    this.contextOf(options.contextId).docs.set(options.docId, doc);
    return [doc] as unknown as Awaited<
      ReturnType<CopilotClient['addContextDoc']>
    >;
  }
  override async removeContextDoc(options: {
    contextId: string;
    docId: string;
  }): ReturnType<CopilotClient['removeContextDoc']> {
    this.contexts.get(options.contextId)?.docs.delete(options.docId);
    return true as Awaited<ReturnType<CopilotClient['removeContextDoc']>>;
  }
  override async addContextFile(
    file: File,
    options: { contextId: string }
  ): ReturnType<CopilotClient['addContextFile']> {
    const entry = {
      id: nanoid(),
      blobId: nanoid(),
      name: file.name,
      status: 'finished',
      error: null,
      createdAt: Date.now(),
      chunkSize: 0,
    };
    this.contextOf(options.contextId).files.set(entry.id, entry);
    return entry as unknown as Awaited<
      ReturnType<CopilotClient['addContextFile']>
    >;
  }
  override async removeContextFile(options: {
    contextId: string;
    fileId: string;
  }): ReturnType<CopilotClient['removeContextFile']> {
    this.contexts.get(options.contextId)?.files.delete(options.fileId);
    return true as Awaited<ReturnType<CopilotClient['removeContextFile']>>;
  }
  override async addContextCategory(): ReturnType<
    CopilotClient['addContextCategory']
  > {
    return { docs: [] } as unknown as Awaited<
      ReturnType<CopilotClient['addContextCategory']>
    >;
  }
  override async removeContextCategory(): ReturnType<
    CopilotClient['removeContextCategory']
  > {
    return true as Awaited<ReturnType<CopilotClient['removeContextCategory']>>;
  }
  override async addContextBlob(): ReturnType<CopilotClient['addContextBlob']> {
    return { status: 'finished', createdAt: Date.now() } as unknown as Awaited<
      ReturnType<CopilotClient['addContextBlob']>
    >;
  }
  override async removeContextBlob(): ReturnType<
    CopilotClient['removeContextBlob']
  > {
    return true as Awaited<ReturnType<CopilotClient['removeContextBlob']>>;
  }
  override async getContextDocsAndFiles(
    _workspaceId: string,
    _sessionId: string,
    contextId: string
  ): ReturnType<CopilotClient['getContextDocsAndFiles']> {
    const context = this.contexts.get(contextId);
    if (!context) return undefined;
    return {
      id: contextId,
      docs: [...context.docs.values()],
      files: [...context.files.values()],
      tags: [],
      collections: [],
      blobs: [],
    } as unknown as Awaited<
      ReturnType<CopilotClient['getContextDocsAndFiles']>
    >;
  }

  private contextOf(contextId: string) {
    let context = this.contexts.get(contextId);
    if (!context) {
      context = { docs: new Map(), files: new Map() };
      this.contexts.set(contextId, context);
    }
    return context;
  }
  override async matchContext(): ReturnType<CopilotClient['matchContext']> {
    return { files: [], docs: [] } as unknown as Awaited<
      ReturnType<CopilotClient['matchContext']>
    >;
  }
}

/**
 * Build an {@link AIRequestService} backed by the local model. Pass a
 * {@link DocEmbedder} to enable doc RAG on chat replies, and a
 * {@link LocalVisionService} to caption images for image actions.
 */
export function createLocalAIRequestService(
  llm: LocalLLMService,
  docEmbedder?: DocEmbedder,
  vision?: LocalVisionService
) {
  return new AIRequestService(new LocalCopilotClient(llm, docEmbedder, vision));
}
