import { randomUUID } from 'node:crypto';

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Cache } from '../../base';
import { CurrentUser, Public } from '../auth';

const TTL_MS = 10 * 60 * 1000;
// Conservative cap: entries are held as base64 in Redis, so this is meant
// for attachments/avatars/images pulled in via Uppy's cloud sources, not
// arbitrarily large files.
const MAX_BYTES = 25 * 1024 * 1024;

interface RelayEntry {
  userId: string;
  state: 'pending' | 'ready';
  contentType?: string;
  dataBase64?: string;
}

function keyFor(token: string) {
  return `uppy-relay:${token}`;
}

/**
 * Bridges Uppy Companion's server-to-server remote-file transfer (Google
 * Drive, Dropbox, ...) back to the browser. Companion streams the fetched
 * file directly to whatever upload-transport endpoint it's given — it has
 * no way to hand bytes to the browser itself — so `@uppy/xhr-upload` posts
 * the result here, and the browser makes one authenticated GET to pull it
 * back down as a Blob. Entries are single-read (deleted on GET) and expire
 * after TTL_MS regardless of whether they're ever claimed.
 */
@Controller('/api/uppy-relay')
export class UppyRelayController {
  constructor(private readonly cache: Cache) {}

  /** Mints a single-use token for one upcoming file transfer. */
  @Post()
  async mint(@CurrentUser() user: CurrentUser): Promise<{ token: string }> {
    const token = randomUUID();
    await this.cache.set<RelayEntry>(
      keyFor(token),
      { userId: user.id, state: 'pending' },
      { ttl: TTL_MS }
    );
    return { token };
  }

  /**
   * Companion posts the transferred file here. Unauthenticated by cookie
   * (the request originates from Companion, not the user's browser) —
   * authorized instead by the unguessable, single-use, short-lived token.
   */
  @Public()
  @Post(':token')
  async receive(@Param('token') token: string, @Req() req: Request) {
    const entry = await this.cache.get<RelayEntry>(keyFor(token));
    if (!entry || entry.state !== 'pending') {
      throw new HttpException(
        'Invalid or expired upload token',
        HttpStatus.NOT_FOUND
      );
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += (chunk as Buffer).length;
      if (total > MAX_BYTES) {
        throw new HttpException('File too large', HttpStatus.PAYLOAD_TOO_LARGE);
      }
      chunks.push(chunk as Buffer);
    }

    await this.cache.set<RelayEntry>(
      keyFor(token),
      {
        userId: entry.userId,
        state: 'ready',
        contentType: req.headers['content-type'] || 'application/octet-stream',
        dataBase64: Buffer.concat(chunks).toString('base64'),
      },
      { ttl: TTL_MS }
    );
    return { ok: true };
  }

  /** The browser's one-time fetch of the relayed bytes. */
  @Get(':token')
  async fetch(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUser,
    @Res() res: Response
  ) {
    const entry = await this.cache.getAndDelete<RelayEntry>(keyFor(token));
    if (
      !entry ||
      entry.state !== 'ready' ||
      entry.userId !== user.id ||
      !entry.dataBase64
    ) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }
    res.setHeader(
      'content-type',
      entry.contentType || 'application/octet-stream'
    );
    res.end(Buffer.from(entry.dataBase64, 'base64'));
  }
}
