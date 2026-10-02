import { Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { AuthenticationRequired, CryptoHelper } from '../../base';
import { Models } from '../../models';
import { sessionUser } from './service';
import type { CurrentUser, Session } from './session';

const JWT_SESSION_TYPE = 'user_session';
const JWT_SESSION_ISSUER = 'notesgraph';
const JWT_SESSION_AUDIENCE = 'notesgraph-client';
const JWT_SESSION_TTL = 15 * 60;

export interface SignedJwtSession {
  token: string;
  expiresAt: Date;
}

interface UserSessionJwtPayload extends JwtPayload {
  sub: string;
  sid: string;
  typ: typeof JWT_SESSION_TYPE;
}

function isUserSessionJwtPayload(
  payload: string | JwtPayload
): payload is UserSessionJwtPayload {
  return (
    typeof payload !== 'string' &&
    typeof payload.sub === 'string' &&
    typeof payload.sid === 'string' &&
    payload.typ === JWT_SESSION_TYPE
  );
}

@Injectable()
export class JwtSessionService {
  constructor(
    private readonly crypto: CryptoHelper,
    private readonly models: Models
  ) {}

  private get currentKey() {
    return Buffer.concat([
      Buffer.from('notesgraph:user-session-jwt:v1:'),
      this.crypto.keyPair.sha256.privateKey,
    ]);
  }

  sign(userId: string, sessionId: string): SignedJwtSession {
    const expiresAt = new Date(Date.now() + JWT_SESSION_TTL * 1000);
    const token = jwt.sign(
      { sid: sessionId, typ: JWT_SESSION_TYPE },
      this.currentKey,
      {
        algorithm: 'HS256',
        audience: JWT_SESSION_AUDIENCE,
        expiresIn: JWT_SESSION_TTL,
        issuer: JWT_SESSION_ISSUER,
        subject: userId,
      }
    );

    return { token, expiresAt };
  }

  async verify(
    token: string,
    options?: { ignoreExpiration?: boolean }
  ): Promise<Session> {
    let payload: string | JwtPayload;
    try {
      payload = jwt.verify(token, this.currentKey, {
        algorithms: ['HS256'],
        audience: JWT_SESSION_AUDIENCE,
        issuer: JWT_SESSION_ISSUER,
        ignoreExpiration: options?.ignoreExpiration,
      });
    } catch {
      throw new AuthenticationRequired();
    }

    if (!isUserSessionJwtPayload(payload)) throw new AuthenticationRequired();
    const userSession = await this.models.session
      .findUserSessionsBySessionId(payload.sid)
      .then(sessions => sessions.find(s => s.userId === payload.sub));
    if (!userSession) throw new AuthenticationRequired();
    const user = await this.models.user.get(payload.sub);
    if (!user) throw new AuthenticationRequired();
    return { ...userSession, user: sessionUser(user) as CurrentUser };
  }

  /**
   * Whether `token` is one we signed whose only fault is being past `exp` -
   * as opposed to forged, malformed or for another audience. Signature-only;
   * it does not look at the underlying session.
   */
  isExpired(token: string): boolean {
    try {
      const payload = jwt.verify(token, this.currentKey, {
        algorithms: ['HS256'],
        audience: JWT_SESSION_AUDIENCE,
        issuer: JWT_SESSION_ISSUER,
        ignoreExpiration: true,
      });
      return (
        isUserSessionJwtPayload(payload) &&
        typeof payload.exp === 'number' &&
        payload.exp * 1000 <= Date.now()
      );
    } catch {
      return false;
    }
  }

  /**
   * Re-issue a fresh 15-minute JWT from one that's expired (or about to
   * expire), without requiring the client to re-authenticate. The signature/
   * audience/issuer are still fully verified — only `exp` is not enforced —
   * and `verify`'s underlying-session lookup already rejects a session that
   * was actually revoked/expired server-side, so this can't resurrect a dead
   * session, only extend a still-valid one.
   *
   * It also slides the underlying session's own expiry, as a cookie request
   * does in the guard. Without that, a native client's session died a fixed
   * `session.ttl` (15 days) after sign-in however much it was used - JWT
   * requests never touch the session row - and the Android app logged its
   * users out every two weeks. An app in use refreshes every ~15 minutes, so
   * this is where activity is visible.
   */
  async refresh(token: string): Promise<SignedJwtSession> {
    const session = await this.verify(token, { ignoreExpiration: true });
    await this.models.session.refreshUserSessionIfNeeded(session);
    return this.sign(session.userId, session.sessionId);
  }
}

export function isLikelyJwt(token: string) {
  return token.split('.').length === 3;
}
