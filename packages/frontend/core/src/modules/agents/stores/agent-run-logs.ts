import { Store } from '@notesgraph/infra';
import { type IDBPDatabase, openDB } from 'idb';

import type { ChatMessage } from '../services/cloud-runner';

const DB_NAME = 'notesgraph-agent-run-logs';
const DB_VERSION = 1;
const LOGS = 'logs';

/** Most transcript kept per run; past this the head is dropped. */
const MAX_LOG_CHARS = 100_000;

interface AgentRunLog {
  runId: string;
  text: string;
}

/**
 * An ask chat's turns, to show it again and go on with it. `history` is what
 * the model was sent after the opening, attached files' text included.
 */
export interface SavedAskChat {
  turns: {
    role: 'user' | 'assistant';
    content: string;
    files?: string[];
    /** When it was asked or answered. */
    at?: number;
  }[];
  history: ChatMessage[];
}

interface AgentRunChat {
  runId: string;
  chat: SavedAskChat;
}

/** Kept beside the run's transcript, under its own key. */
const chatKey = (runId: string) => `${runId}:chat`;

/**
 * Transcripts of runs that happened in this browser.
 *
 * Not the userdata DB the run records live in: that syncs, and a transcript
 * is large, written once and read rarely — the design note's reason for
 * keeping runs small. Not the workspace blob store either: it has no delete,
 * so pruned runs would leave their transcripts behind on the server forever.
 * The cost is that an on-device run's log is readable only on the device
 * that ran it, which is also the only place it could have been watched live.
 * A remote run's transcript is on the server instead.
 */
export class AgentRunLogsStore extends Store {
  private db: Promise<IDBPDatabase<any>> | null = null;

  private getDB() {
    if (!this.db) {
      this.db = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(LOGS)) {
            db.createObjectStore(LOGS, { keyPath: 'runId' });
          }
        },
      });
    }
    return this.db;
  }

  async get(runId: string): Promise<string | undefined> {
    const db = await this.getDB();
    return ((await db.get(LOGS, runId)) as AgentRunLog | undefined)?.text;
  }

  async put(runId: string, text: string): Promise<void> {
    const db = await this.getDB();
    const kept =
      text.length > MAX_LOG_CHARS
        ? `… earlier output dropped …\n${text.slice(-MAX_LOG_CHARS)}`
        : text;
    await db.put(LOGS, { runId, text: kept } satisfies AgentRunLog);
  }

  async getChat(runId: string): Promise<SavedAskChat | undefined> {
    const db = await this.getDB();
    return ((await db.get(LOGS, chatKey(runId))) as AgentRunChat | undefined)
      ?.chat;
  }

  async putChat(runId: string, chat: SavedAskChat): Promise<void> {
    const db = await this.getDB();
    await db.put(LOGS, {
      runId: chatKey(runId),
      chat,
    } satisfies AgentRunChat);
  }

  async delete(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    const db = await this.getDB();
    const tx = db.transaction(LOGS, 'readwrite');
    await Promise.all([
      ...runIds.flatMap(id => [
        tx.store.delete(id),
        tx.store.delete(chatKey(id)),
      ]),
      tx.done,
    ]);
  }
}
