import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ActionForbidden, InvalidAuthState } from '../../base';
import { AuthChallengeStore } from './challenge-store';
import { isNativeClientRequest } from './input';
import { JwtSessionService } from './jwt-session';
import { AuthService } from './service';

interface SessionExchangePayload {
  userId: string;
  sessionId: string;
}

@Injectable()
export class SessionExchangeService {
  constructor(
    private readonly auth: AuthService,
    private readonly challenges: AuthChallengeStore,
    private readonly jwtSession: JwtSessionService
  ) {}

  async createCode(req: Request, userId: string, sessionId: string) {
    if (!isNativeClientRequest(req)) {
      return;
    }

    return this.challenges.create<SessionExchangePayload>(
      'native_session_exchange',
      { userId, sessionId },
      60 * 1000
    );
  }

  async exchange(req: Request, code: string) {
    if (!isNativeClientRequest(req)) {
      throw new ActionForbidden();
    }

    const payload = await this.challenges.consume<SessionExchangePayload>(
      'native_session_exchange',
      code
    );

    if (!payload?.userId || !payload.sessionId) {
      throw new InvalidAuthState();
    }

    const session = await this.auth.getUserSession(
      payload.sessionId,
      payload.userId
    );
    if (!session) {
      throw new InvalidAuthState();
    }

    return this.jwtSession.sign(payload.userId, payload.sessionId);
  }

  /**
   * Silently re-issue a fresh JWT from an expired (or expiring) one, so a
   * native client's 15-minute access token doesn't force a full re-login on
   * every idle gap over 15 minutes.
   *
   * Unlike exchange()/createCode(), this deliberately does NOT gate on
   * isNativeClientRequest(): that header (x-notesgraph-client-kind: native)
   * is only ever attached by the native Kotlin/Swift/Electron-main HTTP
   * clients, never by JS running in the WebView — and refresh has to be
   * callable from the WebView's own fetch (it fires reactively off a 401 on
   * any request, most of which are ordinary JS fetches, not the native
   * plugin's own calls). Requiring the header here would make refresh
   * unreachable from the one place that actually needs it. Possession of a
   * signature-valid JWT for a still-live session (checked by
   * jwtSession.refresh() itself) is already sufficient proof this is a
   * native session — JWTs are only ever issued through the native-gated
   * exchange flow above.
   */
  async refresh(token: string) {
    return this.jwtSession.refresh(token);
  }
}
