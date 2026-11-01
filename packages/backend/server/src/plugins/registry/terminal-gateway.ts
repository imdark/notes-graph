import { applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage as RawSubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ClsInterceptor } from 'nestjs-cls';
import type { Server, Socket } from 'socket.io';

import { BadRequest, Config, GatewayErrorWrapper } from '../../base';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { TerminalSessionService } from './terminal-sessions';

const SubscribeMessage = (event: string) =>
  applyDecorators(GatewayErrorWrapper(event), RawSubscribeMessage(event));

/** Keystrokes and pastes are small; refuse anything that is not. */
const MAX_INPUT = 64 * 1024;
const MAX_OUTPUT = 256 * 1024;

const viewerRoom = (workspaceId: string, sessionId: string) =>
  `terminal:view:${workspaceId}:${sessionId}`;
const deviceRoom = (workspaceId: string, deviceKey: string) =>
  `terminal:device:${workspaceId}:${deviceKey}`;

interface SessionRef {
  workspaceId: string;
  sessionId: string;
}

/**
 * Remote terminals: a harness (Claude Code and the like) runs under `wf` on
 * a registered device, and this relays its screen to browsers and their
 * keystrokes back, over websockets.
 *
 * Two kinds of peer join. A viewer (the app) opens, attaches to and drives
 * sessions. A device (`wf terminal serve`, on a PAT) announces itself, is told
 * which sessions to start, and sends what each prints. Closing a browser
 * only detaches: the session and its recent output stay for the next attach.
 *
 * Running a shell on a machine is the strongest thing the registry offers,
 * so viewers need workspace settings access, the same bar as editing the
 * fleet; devices need the same, since a token that can attach as a device
 * can read every keystroke sent to it.
 */
@WebSocketGateway()
@UseInterceptors(ClsInterceptor)
export class TerminalGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly sessions: TerminalSessionService,
    private readonly ac: PermissionAccess,
    private readonly config: Config
  ) {}

  handleDisconnect() {
    // Rooms are left with the socket; sessions deliberately outlive it.
  }

  private async assertAllowed(user: CurrentUser, workspaceId: unknown) {
    if (!this.config.registry.enabled) {
      throw new BadRequest('Registry API is not enabled on this server');
    }
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw new BadRequest('workspaceId is required');
    }
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
  }

  private session({ workspaceId, sessionId }: SessionRef) {
    const session = this.sessions.get(workspaceId, String(sessionId));
    if (!session) throw new BadRequest('No such terminal session');
    return session;
  }

  // ── viewer (the app) ──────────────────────────────────────────────────

  @SubscribeMessage('terminal:list')
  async list(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: { workspaceId: string; deviceKey?: string }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    return {
      data: {
        sessions: this.sessions.list(body.workspaceId, body.deviceKey),
        devices: await this.onlineDevices(body.workspaceId),
      },
    };
  }

  @SubscribeMessage('terminal:open')
  async open(
    @CurrentUser() user: CurrentUser,
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      workspaceId: string;
      deviceKey: string;
      harness: string;
      resume?: string;
      cols?: number;
      rows?: number;
    }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    if (!body.deviceKey) throw new BadRequest('deviceKey is required');
    if (
      !(await this.onlineDevices(body.workspaceId)).includes(body.deviceKey)
    ) {
      throw new BadRequest(
        'That device is not connected. Run `wf terminal serve` on it.'
      );
    }
    const session = this.sessions.open({ ...body, userId: user.id });
    await client.join(viewerRoom(session.workspaceId, session.id));
    this.server
      .to(deviceRoom(session.workspaceId, session.deviceKey))
      .emit('terminal:spawn', session);
    return { data: { session } };
  }

  /** Join a session's screen; returns what has been shown so far. */
  @SubscribeMessage('terminal:attach')
  async attach(
    @CurrentUser() user: CurrentUser,
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SessionRef & { since?: number }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    this.session(body);
    await client.join(viewerRoom(body.workspaceId, body.sessionId));
    return {
      data: this.sessions.snapshot(
        body.workspaceId,
        body.sessionId,
        Number(body.since) || 0
      ),
    };
  }

  @SubscribeMessage('terminal:detach')
  async detach(
    @CurrentUser() user: CurrentUser,
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SessionRef
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    await client.leave(viewerRoom(body.workspaceId, body.sessionId));
    return { data: { ok: true } };
  }

  @SubscribeMessage('terminal:input')
  async input(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef & { data: string }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    const session = this.session(body);
    if (typeof body.data !== 'string' || body.data.length > MAX_INPUT) {
      throw new BadRequest('input must be a string under 64 KB');
    }
    if (session.status === 'exited') throw new BadRequest('Session has ended');
    this.server
      .to(deviceRoom(session.workspaceId, session.deviceKey))
      .emit('terminal:stdin', { sessionId: session.id, data: body.data });
    return { data: { ok: true } };
  }

  @SubscribeMessage('terminal:resize')
  async resize(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef & { cols: number; rows: number }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    const session = this.session(body);
    const next = this.sessions.resize(
      session.workspaceId,
      session.id,
      body.cols,
      body.rows
    );
    if (next) {
      this.server
        .to(deviceRoom(session.workspaceId, session.deviceKey))
        .emit('terminal:resize', {
          sessionId: session.id,
          cols: next.cols,
          rows: next.rows,
        });
    }
    return { data: { ok: true } };
  }

  /** End the harness (and, once it has exited, forget the session). */
  @SubscribeMessage('terminal:close')
  async close(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    const session = this.session(body);
    if (session.status === 'exited') {
      this.sessions.remove(session.workspaceId, session.id);
    } else {
      this.server
        .to(deviceRoom(session.workspaceId, session.deviceKey))
        .emit('terminal:kill', { sessionId: session.id });
      // A session the device never started has nobody to end it.
      if (session.status === 'starting') {
        this.sessions.exit(session.workspaceId, session.id, null);
        this.server
          .to(viewerRoom(session.workspaceId, session.id))
          .emit('terminal:exit', { sessionId: session.id, code: null });
      }
    }
    return { data: { ok: true } };
  }

  // ── device (`wf terminal serve`) ──────────────────────────────────────

  /**
   * A device says it is ready. Replies with sessions still waiting for it,
   * and with the live ones so it can tell which it lost track of.
   */
  @SubscribeMessage('terminal:device:attach')
  async deviceAttach(
    @CurrentUser() user: CurrentUser,
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId: string; deviceKey: string }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    if (!body.deviceKey) throw new BadRequest('deviceKey is required');
    await client.join(deviceRoom(body.workspaceId, body.deviceKey));
    client.data.terminalDevice = {
      workspaceId: body.workspaceId,
      deviceKey: body.deviceKey,
    };
    return {
      data: {
        pending: this.sessions.pending(body.workspaceId, body.deviceKey),
        live: this.sessions
          .list(body.workspaceId, body.deviceKey)
          .filter(s => s.status === 'running'),
      },
    };
  }

  @SubscribeMessage('terminal:device:output')
  async deviceOutput(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef & { data: string }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    if (typeof body.data !== 'string' || body.data.length > MAX_OUTPUT) {
      throw new BadRequest('output must be a string under 256 KB');
    }
    const session = this.session(body);
    const before = session.length;
    this.sessions.append(session.workspaceId, session.id, body.data);
    this.server
      .to(viewerRoom(session.workspaceId, session.id))
      .emit('terminal:output', {
        sessionId: session.id,
        data: body.data,
        offset: before,
      });
    return { data: { ok: true } };
  }

  @SubscribeMessage('terminal:device:started')
  async deviceStarted(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    const session = this.sessions.markRunning(
      body.workspaceId,
      String(body.sessionId)
    );
    if (session) {
      this.server
        .to(viewerRoom(session.workspaceId, session.id))
        .emit('terminal:status', { session });
    }
    return { data: { ok: true } };
  }

  @SubscribeMessage('terminal:device:exit')
  async deviceExit(
    @CurrentUser() user: CurrentUser,
    @MessageBody() body: SessionRef & { code?: number }
  ) {
    await this.assertAllowed(user, body?.workspaceId);
    const session = this.sessions.exit(
      body.workspaceId,
      String(body.sessionId),
      body.code
    );
    if (session) {
      this.server
        .to(viewerRoom(session.workspaceId, session.id))
        .emit('terminal:exit', {
          sessionId: session.id,
          code: session.exitCode,
        });
    }
    return { data: { ok: true } };
  }

  private async onlineDevices(workspaceId: string): Promise<string[]> {
    const sockets = await this.server
      .in(
        // Every device room of this workspace: listed by prefix below.
        [...this.server.sockets.adapter.rooms.keys()].filter(room =>
          room.startsWith(`terminal:device:${workspaceId}:`)
        )
      )
      .fetchSockets();
    return [
      ...new Set(
        sockets.flatMap(s => {
          const d = s.data.terminalDevice as
            { workspaceId: string; deviceKey: string } | undefined;
          return d?.workspaceId === workspaceId ? [d.deviceKey] : [];
        })
      ),
    ];
  }
}
