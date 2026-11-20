import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { BaseModel } from './base';

/** The manifest.json an agent plugin is served with (see @notesgraph/plugin-sdk). */
export interface AgentPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  platforms: ('web' | 'desktop' | 'mobile')[];
  permissions: string[];
  entry: { client: string };
}

export interface SaveAgentPluginInput {
  workspaceId: string;
  pluginId: string;
  name: string;
  description?: string;
  permissions: string[];
  code: string;
  userId?: string;
  agent?: string;
}

// Everything but the code, which only the download route needs.
const metadata = {
  id: true,
  workspaceId: true,
  pluginId: true,
  token: true,
  version: true,
  manifest: true,
  createdBy: true,
  updatedBy: true,
  agent: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** 1.0.0 → 1.0.1: each save is a new version, which also gives index.js a new URL. */
export function nextPatchVersion(version: string | undefined): string {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return '1.0.0';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

@Injectable()
export class AgentPluginModel extends BaseModel {
  async list(workspaceId: string) {
    return await this.db.agentPlugin.findMany({
      where: { workspaceId },
      select: metadata,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, pluginId: string) {
    return await this.db.agentPlugin.findUnique({
      where: { workspaceId_pluginId: { workspaceId, pluginId } },
      select: { ...metadata, code: true },
    });
  }

  async getByToken(token: string) {
    return await this.db.agentPlugin.findUnique({
      where: { token },
      select: { manifest: true, code: true },
    });
  }

  /** Create the plugin, or replace its code and bump its patch version. */
  async save(input: SaveAgentPluginInput) {
    const existing = await this.db.agentPlugin.findUnique({
      where: {
        workspaceId_pluginId: {
          workspaceId: input.workspaceId,
          pluginId: input.pluginId,
        },
      },
      select: { version: true },
    });
    const version = existing ? nextPatchVersion(existing.version) : '1.0.0';
    const manifest: AgentPluginManifest = {
      id: input.pluginId,
      name: input.name,
      version,
      ...(input.description ? { description: input.description } : {}),
      ...(input.agent ? { author: input.agent } : {}),
      platforms: ['web', 'desktop', 'mobile'],
      permissions: input.permissions,
      // The browser caches an import() by URL for the life of the page, so
      // a new version needs a new URL to load without a full reload.
      entry: { client: `index.js?v=${version}` },
    };
    return await this.db.agentPlugin.upsert({
      where: {
        workspaceId_pluginId: {
          workspaceId: input.workspaceId,
          pluginId: input.pluginId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        pluginId: input.pluginId,
        token: randomBytes(24).toString('base64url'),
        version,
        manifest: manifest as object,
        code: input.code,
        createdBy: input.userId,
        updatedBy: input.userId,
        agent: input.agent,
      },
      update: {
        version,
        manifest: manifest as object,
        code: input.code,
        updatedBy: input.userId,
        agent: input.agent,
      },
      select: metadata,
    });
  }

  async delete(workspaceId: string, pluginId: string) {
    const { count } = await this.db.agentPlugin.deleteMany({
      where: { workspaceId, pluginId },
    });
    return count > 0;
  }
}
