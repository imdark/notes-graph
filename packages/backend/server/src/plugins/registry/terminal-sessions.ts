import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { BadRequest } from '../../base';

/** Harnesses a device is asked to run, each launched through `wf`. */
export const TERMINAL_HARNESSES = [
  'claude',
  'codex',
  'gemini',
  'shell',
] as const;
export type TerminalHarness = (typeof TERMINAL_HARNESSES)[number];

/** Output kept per session so a browser that reconnects sees the screen. */
export const SCROLLBACK_LIMIT = 512 * 1024;
const MAX_SESSIONS_PER_DEVICE = 8;
const MAX_DIMENSION = 500;

export type TerminalStatus =
  /** Waiting for the device to start the harness. */
  'starting' | 'running' | 'exited';

export interface TerminalSession {
  id: string;
  workspaceId: string;
  deviceKey: string;
  harness: TerminalHarness;
  /** A harness conversation to pick up again, when the device has one. */
  resume: string | null;
  userId: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
  /** Total characters ever output; a viewer asks for what follows its own. */
  length: number;
}

interface Stored extends TerminalSession {
  scrollback: string;
}

const clampSize = (value: unknown, fallback: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DIMENSION ? n : fallback;
};

export const parseHarness = (value: unknown): TerminalHarness => {
  if ((TERMINAL_HARNESSES as readonly string[]).includes(value as string)) {
    return value as TerminalHarness;
  }
  throw new BadRequest(
    `harness must be one of ${TERMINAL_HARNESSES.join(', ')}`
  );
};

/** Opaque id a harness resumes by: kept to a shell-safe alphabet. */
export const parseResume = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new BadRequest('resume must be a conversation id');
  }
  return value;
};

/**
 * Terminal sessions on devices, and the screen each has shown.
 *
 * The harness runs on the device; this keeps only the recent output, so a
 * browser can leave and come back to the same session. Held in memory: a
 * server restart ends the sessions' scrollback, not the harness, which the
 * device can offer again through `resume`.
 */
@Injectable()
export class TerminalSessionService {
  private readonly sessions = new Map<string, Stored>();

  open(input: {
    workspaceId: string;
    deviceKey: string;
    userId: string;
    harness: unknown;
    resume?: unknown;
    cols?: unknown;
    rows?: unknown;
  }): TerminalSession {
    const live = this.list(input.workspaceId, input.deviceKey).filter(
      s => s.status !== 'exited'
    );
    if (live.length >= MAX_SESSIONS_PER_DEVICE) {
      throw new BadRequest(
        `${MAX_SESSIONS_PER_DEVICE} sessions are open on this device already`
      );
    }
    const now = Date.now();
    const session: Stored = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      deviceKey: input.deviceKey,
      harness: parseHarness(input.harness),
      resume: parseResume(input.resume),
      userId: input.userId,
      cols: clampSize(input.cols, 120),
      rows: clampSize(input.rows, 32),
      status: 'starting',
      exitCode: null,
      createdAt: now,
      updatedAt: now,
      length: 0,
      scrollback: '',
    };
    this.sessions.set(session.id, session);
    return this.view(session);
  }

  get(workspaceId: string, id: string): TerminalSession | null {
    const s = this.sessions.get(id);
    return s && s.workspaceId === workspaceId ? this.view(s) : null;
  }

  list(workspaceId: string, deviceKey?: string): TerminalSession[] {
    return [...this.sessions.values()]
      .filter(
        s =>
          s.workspaceId === workspaceId &&
          (deviceKey === undefined || s.deviceKey === deviceKey)
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(s => this.view(s));
  }

  /** Sessions the device has not started yet. */
  pending(workspaceId: string, deviceKey: string): TerminalSession[] {
    return this.list(workspaceId, deviceKey).filter(
      s => s.status === 'starting'
    );
  }

  markRunning(workspaceId: string, id: string) {
    const s = this.find(workspaceId, id);
    if (!s || s.status === 'exited') return null;
    s.status = 'running';
    s.updatedAt = Date.now();
    return this.view(s);
  }

  append(workspaceId: string, id: string, data: string) {
    const s = this.find(workspaceId, id);
    if (!s) return null;
    s.scrollback += data;
    s.length += data.length;
    if (s.scrollback.length > SCROLLBACK_LIMIT) {
      s.scrollback = s.scrollback.slice(-SCROLLBACK_LIMIT);
    }
    s.status = s.status === 'starting' ? 'running' : s.status;
    s.updatedAt = Date.now();
    return this.view(s);
  }

  resize(workspaceId: string, id: string, cols: unknown, rows: unknown) {
    const s = this.find(workspaceId, id);
    if (!s) return null;
    s.cols = clampSize(cols, s.cols);
    s.rows = clampSize(rows, s.rows);
    return this.view(s);
  }

  exit(workspaceId: string, id: string, code: unknown) {
    const s = this.find(workspaceId, id);
    if (!s) return null;
    s.status = 'exited';
    s.exitCode = Number.isFinite(Number(code)) ? Number(code) : null;
    s.updatedAt = Date.now();
    return this.view(s);
  }

  /** The output a viewer is missing, and where it now stands. */
  snapshot(workspaceId: string, id: string, since = 0) {
    const s = this.find(workspaceId, id);
    if (!s) return null;
    const start = s.length - s.scrollback.length;
    // Asked from before what is kept: start from the oldest kept.
    const from = Math.min(Math.max(since, start), s.length);
    return {
      session: this.view(s),
      data: s.scrollback.slice(from - start),
      from,
    };
  }

  remove(workspaceId: string, id: string) {
    const s = this.find(workspaceId, id);
    return s ? this.sessions.delete(id) : false;
  }

  private find(workspaceId: string, id: string) {
    const s = this.sessions.get(id);
    return s && s.workspaceId === workspaceId ? s : undefined;
  }

  private view({ scrollback: _, ...session }: Stored): TerminalSession {
    return { ...session };
  }
}
