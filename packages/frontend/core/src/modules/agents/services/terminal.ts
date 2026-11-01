import { LiveData, Service } from '@notesgraph/infra';
import { io, type Socket } from 'socket.io-client';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceService } from '../../workspace';
import { TerminalScreen } from './terminal-screen';

export const TERMINAL_HARNESSES = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'shell', name: 'Shell' },
] as const;
export type TerminalHarnessId = (typeof TERMINAL_HARNESSES)[number]['id'];

export interface TerminalSessionInfo {
  id: string;
  deviceKey: string;
  harness: TerminalHarnessId;
  resume: string | null;
  status: 'starting' | 'running' | 'exited';
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
  length: number;
}

interface Ack<T> {
  data?: T;
  error?: { message: string };
}

/**
 * The app's side of a remote terminal: one socket to the server, relayed to
 * a harness running under `wf` on a device. The screen is rebuilt from the
 * server's recent output on every attach, so leaving and coming back (or
 * reloading the page) lands on the same conversation.
 */
export class TerminalConnection {
  readonly screen = new TerminalScreen();
  readonly session$: LiveData<TerminalSessionInfo>;
  /** Bumped whenever the screen changed. */
  readonly tick$ = new LiveData(0);
  readonly connected$ = new LiveData(false);
  private received = 0;
  private listeners: (() => void)[] = [];

  constructor(
    private readonly socket: Socket,
    private readonly workspaceId: string,
    session: TerminalSessionInfo
  ) {
    this.session$ = new LiveData(session);
    const on = (event: string, fn: (...args: any[]) => void) => {
      socket.on(event, fn);
      this.listeners.push(() => socket.off(event, fn));
    };
    on(
      'terminal:output',
      (m: { sessionId: string; data: string; offset: number }) => {
        if (m.sessionId !== session.id) return;
        // A gap means output was missed in a reconnect: fetch it again.
        if (m.offset !== this.received) return void this.sync();
        this.take(m.data);
      }
    );
    on('terminal:status', (m: { session: TerminalSessionInfo }) => {
      if (m.session.id === session.id) this.session$.setValue(m.session);
    });
    on('terminal:exit', (m: { sessionId: string; code: number | null }) => {
      if (m.sessionId !== session.id) return;
      this.session$.setValue({
        ...this.session$.value,
        status: 'exited',
        exitCode: m.code,
      });
    });
    on('connect', () => {
      this.connected$.setValue(true);
      this.sync().catch(() => {});
    });
    on('disconnect', () => this.connected$.setValue(false));
    this.connected$.setValue(socket.connected);
  }

  private take(data: string) {
    this.received += data.length;
    this.screen.write(data);
    this.tick$.setValue(this.tick$.value + 1);
  }

  /** Join the session and catch up on what was printed meanwhile. */
  async sync() {
    const res = await emit<{
      session: TerminalSessionInfo;
      data: string;
      from: number;
    }>(this.socket, 'terminal:attach', {
      workspaceId: this.workspaceId,
      sessionId: this.session$.value.id,
      since: this.received,
    });
    this.session$.setValue(res.session);
    if (res.from > this.received) {
      // What we had scrolled out of the server's buffer: start over.
      this.screen.reset();
      this.received = res.from;
    }
    this.take(res.data);
  }

  send(data: string) {
    emit(this.socket, 'terminal:input', {
      workspaceId: this.workspaceId,
      sessionId: this.session$.value.id,
      data,
    }).catch(() => {});
  }

  resize(cols: number, rows: number) {
    this.screen.cols = cols;
    this.screen.viewRows = rows;
    emit(this.socket, 'terminal:resize', {
      workspaceId: this.workspaceId,
      sessionId: this.session$.value.id,
      cols,
      rows,
    }).catch(() => {});
  }

  /** End the harness; on an ended session, forget it. */
  async close() {
    await emit(this.socket, 'terminal:close', {
      workspaceId: this.workspaceId,
      sessionId: this.session$.value.id,
    });
  }

  /** Stop watching. The harness keeps running on the device. */
  detach() {
    this.listeners.forEach(off => off());
    this.listeners = [];
    emit(this.socket, 'terminal:detach', {
      workspaceId: this.workspaceId,
      sessionId: this.session$.value.id,
    }).catch(() => {});
  }
}

const emit = <T>(socket: Socket, event: string, body: unknown) =>
  new Promise<T>((resolve, reject) => {
    socket.timeout(15_000).emit(event, body, (err: unknown, res: Ack<T>) => {
      if (err) return reject(new Error('The server did not answer'));
      if (res?.error) return reject(new Error(res.error.message));
      resolve(res?.data as T);
    });
  });

export class TerminalService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  private socket: Socket | null = null;
  private readonly connections = new Map<string, TerminalConnection>();

  get hasServer(): boolean {
    return !!this.workspaceServerService.server;
  }

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  private getSocket(): Socket {
    if (this.socket) return this.socket;
    const server = this.workspaceServerService.server;
    if (!server) throw new Error('This workspace has no server to connect to.');
    this.socket = io(server.baseUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    return this.socket;
  }

  /** Sessions in this workspace, and the devices ready to start one. */
  async list(deviceKey?: string) {
    return emit<{ sessions: TerminalSessionInfo[]; devices: string[] }>(
      this.getSocket(),
      'terminal:list',
      { workspaceId: this.workspaceId, deviceKey }
    );
  }

  async open(input: {
    deviceKey: string;
    harness: TerminalHarnessId;
    resume?: string;
    cols?: number;
    rows?: number;
  }) {
    const { session } = await emit<{ session: TerminalSessionInfo }>(
      this.getSocket(),
      'terminal:open',
      { workspaceId: this.workspaceId, ...input }
    );
    return this.connect(session);
  }

  /** Watch a session that is already running (a resume after a reload). */
  async attach(session: TerminalSessionInfo) {
    const connection = this.connect(session);
    await connection.sync();
    return connection;
  }

  private connect(session: TerminalSessionInfo) {
    this.connections.get(session.id)?.detach();
    const connection = new TerminalConnection(
      this.getSocket(),
      this.workspaceId,
      session
    );
    this.connections.set(session.id, connection);
    return connection;
  }

  override dispose() {
    this.connections.forEach(c => c.detach());
    this.connections.clear();
    this.socket?.disconnect();
    this.socket = null;
    super.dispose();
  }
}
