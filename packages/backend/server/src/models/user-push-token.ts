import { Injectable } from '@nestjs/common';
import type { UserPushToken } from '@prisma/client';

import { BaseModel } from './base';

@Injectable()
export class UserPushTokenModel extends BaseModel {
  /**
   * Remember a phone for a user. Keyed on the token, not (user, token): a
   * token names one install, so signing in as someone else on the same
   * phone moves it to them rather than notifying both.
   */
  async register(
    userId: string,
    token: string,
    platform: string
  ): Promise<UserPushToken> {
    return this.db.userPushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  /** Forget a phone, but only for the user it belongs to. */
  async unregister(userId: string, token: string): Promise<number> {
    const { count } = await this.db.userPushToken.deleteMany({
      where: { userId, token },
    });
    return count;
  }

  async listForUser(userId: string): Promise<UserPushToken[]> {
    return this.db.userPushToken.findMany({ where: { userId } });
  }

  /** Drop tokens FCM has said are gone (app uninstalled, data cleared). */
  async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.userPushToken.deleteMany({ where: { token: { in: tokens } } });
  }
}
