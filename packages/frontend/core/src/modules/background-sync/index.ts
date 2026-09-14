import { universalId } from '@notesgraph/nbstore';

import type { GlobalState } from '../storage';

/**
 * User setting: "sync local changes in the background". When on, the native
 * background triggers (Android connectivity wake / iOS periodic refresh) are
 * allowed to push pending offline edits to the cloud while the app isn't in the
 * foreground. Stored in GlobalState so the web background-sync boot mode — which
 * the native side launches in a headless WebView — can honor it, and the mobile
 * Settings toggle can read/write it.
 *
 * This is intentionally a plain constants+helpers module (no service to
 * register): the value is a single boolean read directly off GlobalState.
 */
export const BACKGROUND_SYNC_ENABLED_KEY =
  'notesgraph:setting:background-sync-enabled';

/** Default on — offline edits should reach the cloud without the user thinking about it. */
export const DEFAULT_BACKGROUND_SYNC_ENABLED = true;

export function isBackgroundSyncEnabled(globalState: GlobalState): boolean {
  return (
    globalState.get<boolean>(BACKGROUND_SYNC_ENABLED_KEY) ??
    DEFAULT_BACKGROUND_SYNC_ENABLED
  );
}

/** One space the background task should push. See BackgroundSyncWorker.kt. */
export interface SyncManifestSpace {
  /** `@peer(<serverId>);@type(workspace);@id(<workspaceId>);` */
  universalId: string;
  spaceType: 'workspace';
  spaceId: string;
  /** Storage flavour / serverId — locates the local SQLite file. */
  dbPeer: string;
  /** Sync-cursor peer, `cloud:<serverId>`. */
  peerId: string;
}

/** A per-server manifest handed to the native background push task. */
export interface SyncManifest {
  serverBaseUrl: string;
  clientVersion: string;
  spaces: SyncManifestSpace[];
}

/**
 * Build the background-push manifests (one per signed-in cloud server) from the
 * current workspace + server lists. Local workspaces (flavour `'local'`) and
 * servers with no signed-in account are skipped; the token is intentionally
 * omitted (the native worker reads the fresh token itself). Pure/derivable so
 * the platform glue can recompute it reactively whenever workspaces, servers,
 * or the account change.
 *
 * NOTE: the current Android worker consumes a single manifest (the primary
 * cloud server); multi-server support = have the worker loop these.
 */
export function buildSyncManifests(
  workspaces: ReadonlyArray<{ id: string; flavour: string }>,
  servers: ReadonlyArray<{ id: string; baseUrl: string; signedIn: boolean }>,
  clientVersion: string
): SyncManifest[] {
  const serverById = new Map(servers.map(server => [server.id, server]));
  const spacesByBaseUrl = new Map<string, SyncManifestSpace[]>();

  for (const workspace of workspaces) {
    if (workspace.flavour === 'local') continue;
    // For a cloud workspace the metadata flavour IS the serverId.
    const server = serverById.get(workspace.flavour);
    if (!server || !server.signedIn) continue;

    const serverId = server.id;
    const space: SyncManifestSpace = {
      universalId: universalId({
        peer: serverId,
        type: 'workspace',
        id: workspace.id,
      }),
      spaceType: 'workspace',
      spaceId: workspace.id,
      dbPeer: serverId,
      peerId: `cloud:${serverId}`,
    };
    const existing = spacesByBaseUrl.get(server.baseUrl);
    if (existing) existing.push(space);
    else spacesByBaseUrl.set(server.baseUrl, [space]);
  }

  return [...spacesByBaseUrl.entries()].map(([serverBaseUrl, spaces]) => ({
    serverBaseUrl,
    clientVersion,
    spaces,
  }));
}
