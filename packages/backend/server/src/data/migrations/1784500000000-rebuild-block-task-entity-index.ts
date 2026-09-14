import { ModuleRef } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { IndexerService } from '../../plugins/indexer';

/**
 * Recreates the search tables with the block task-entity columns
 * (todo_status, todo_trail, tags, props, org_status, block_created_at and
 * the org planning timestamps) and re-queues every workspace for indexing
 * so existing docs get the new fields backfilled.
 */
export class RebuildBlockTaskEntityIndex1784500000000 {
  static async up(_db: PrismaClient, ref: ModuleRef) {
    await ref.get(IndexerService, { strict: false }).rebuildManticoreIndexes();
  }

  static async down(_db: PrismaClient) {}
}
