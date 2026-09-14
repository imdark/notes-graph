import type { IconData } from '@notesgraph/component';
import {
  type DBSchemaBuilder,
  f,
  type FieldSchemaBuilder,
  type ORMEntity,
  t,
} from '@notesgraph/infra';
import { nanoid } from 'nanoid';

import type { ScheduleRule } from '../../schedule/recurrence';
import type { PublishSiteSettings } from '../../share-doc/publish-site-types';
import type { WorkspacePropertyType } from '../../workspace-property';

const integrationType = f.enum('readwise');

/**
 * One agent: a named prompt a reader can run against a block, a selection or a
 * whole note. Declared once and used in both the workspace schema (shared) and
 * the userdata schema (private to one person) — the two are deliberately the
 * same shape so promoting an agent between scopes is a row copy.
 */
const agentTable = {
  id: f.string().primaryKey().optional().default(nanoid),
  name: f.string(),
  /**
   * Menu icon: an emoji, a built-in icon, or a small data-URL image — the same
   * IconData a note's icon uses, so agents get the same picker (AI generation
   * included) rather than a second, worse one.
   */
  icon: f.json<IconData>().optional(),
  /** Pre-IconData rows stored a bare emoji here; still read, never written. */
  emoji: f.string().optional(),
  /** The system prompt, authored by the reader. */
  instructions: f.string(),
  /**
   * Which runtime executes this agent: 'on-device' (WebLLM in the browser) or
   * 'cloud' (the server's copilot). Unset follows the workspace's own AI
   * backend setting, which is what every agent did before this existed.
   */
  harness: f.string().optional(),
  /** Model id within that harness. Unset uses the harness default. */
  model: f.string().optional(),
  /**
   * Tool allowlist by MCP tool name. Always intersected at call time with the
   * workspace's own read/write toggles, and with the executor's allowlist — a
   * hand-edited or imported row must not be able to widen its own reach.
   */
  tools: f.json<string[]>(),
  /** Which targets this agent may run against: 'block' | 'selection' | 'doc'. */
  targets: f.json<string[]>(),
  /** What happens to the result. Only 'panel' (preview + accept) exists today. */
  output: f.string(),
  /** Tool-loop budget. */
  maxSteps: f.number(),
  /** Hidden from menus without being deleted. */
  enabled: f.boolean(),
  createdAt: f.number(),
  createdBy: f.string().optional(),
} as const;

export const NotesGraph_WORKSPACE_DB_SCHEMA = {
  folders: {
    id: f.string().primaryKey().optional().default(nanoid),
    parentId: f.string().optional(),
    data: f.string(),
    type: f.string(),
    index: f.string(),
  },
  docProperties: t.document({
    // { [`custom:{customPropertyId}`]: any }
    id: f.string().primaryKey(),
    primaryMode: f.string().optional(),
    edgelessColorTheme: f.string().optional(),
    journal: f.string().optional(),
    pageWidth: f.string().optional(),
    isTemplate: f.boolean().optional(),
    integrationType: integrationType.optional(),
    createdBy: f.string().optional(),
    updatedBy: f.string().optional(),
    // recurrence rule for a scheduled/repeating note
    schedule: f.json<ScheduleRule>().optional(),
    // for a materialized occurrence: links back to its recurring source + date
    scheduleInstance: f.json<{ source: string; date: string }>().optional(),
    // per-block schedules in this doc: blockId -> a one-off `date` or a repeat
    // `rule`, optional `time`/`endTime` (HH:MM) for a time or range, plus a text
    // snapshot for display
    scheduleBlocks: f
      .json<
        Record<
          string,
          {
            rule?: ScheduleRule;
            date?: string;
            time?: string;
            endTime?: string;
            text: string;
          }
        >
      >()
      .optional(),
    // "Publish this doc + its descendants as a site" settings, stored on the
    // root doc only (see modules/share-doc/publish-site-types).
    publishSite: f.json<PublishSiteSettings>().optional(),
  }),
  docCustomPropertyInfo: {
    id: f.string().primaryKey().optional().default(nanoid),
    name: f.string().optional(),
    type: f.string() as FieldSchemaBuilder<WorkspacePropertyType, false, false>,
    show: f.enum('always-show', 'always-hide', 'hide-when-empty').optional(),
    index: f.string().optional(),
    icon: f.string().optional(),
    additionalData: f.json().optional(),
    isDeleted: f.boolean().optional(),
    // we will keep deleted properties in the database, for override legacy data
  },
  pinnedCollections: {
    collectionId: f.string().primaryKey(),
    index: f.string(),
  },
  // Local (offline) projects: a named grouping of docs. Cloud workspaces store
  // projects (with member sharing) on the server instead; this table is the
  // local-workspace backend where a project is just a name + an explicit
  // docId list (no members — sharing requires the cloud).
  projects: {
    id: f.string().primaryKey().optional().default(nanoid),
    name: f.string(),
    docIds: f.json<string[]>(),
    createdAt: f.string().optional(),
    index: f.string().optional(),
  },
  // Local (offline) comment threads. Cloud workspaces store comments on the
  // server (with realtime + ACL); these tables are the local-workspace backend.
  // `content` is a BlockSuite `DocCommentContent` snapshot (kept untyped here to
  // avoid a schema<->comment-module dependency cycle; cast on read).
  comments: {
    id: f.string().primaryKey().optional().default(nanoid),
    docId: f.string(),
    content: f.json(),
    resolved: f.boolean().optional(),
    userId: f.string().optional(),
    userName: f.string().optional(),
    userAvatar: f.string().optional(),
    createdAt: f.number(),
    updatedAt: f.number(),
  },
  commentReplies: {
    id: f.string().primaryKey().optional().default(nanoid),
    commentId: f.string(),
    content: f.json(),
    userId: f.string().optional(),
    userName: f.string().optional(),
    userAvatar: f.string().optional(),
    createdAt: f.number(),
    updatedAt: f.number(),
  },
  // Virtual views: a view whose children are external resources kept fresh by
  // a crawler (e.g. a YouTube channel and its videos). The items live in
  // `virtualItems`; neither is a real note.
  virtualViews: {
    id: f.string().primaryKey().optional().default(nanoid),
    // crawler kind, e.g. 'youtube'
    type: f.string(),
    name: f.string(),
    // crawler-specific config, e.g. { channelId } for youtube
    config: f.json(),
    lastCrawledAt: f.number().optional(),
    lastError: f.string().optional(),
    createdAt: f.number(),
  },
  virtualItems: {
    // stable id: `${viewId}:${externalId}`
    id: f.string().primaryKey(),
    viewId: f.string(),
    externalId: f.string(),
    title: f.string(),
    url: f.string(),
    snippet: f.string().optional(),
    thumbnail: f.string().optional(),
    publishedAt: f.number().optional(),
  },
  // Append-only time series for `timeseries` virtual views (price / rate
  // trackers): one numeric reading per crawl.
  virtualDataPoints: {
    id: f.string().primaryKey().optional().default(nanoid),
    viewId: f.string(),
    value: f.number(),
    at: f.number(),
  },
  explorerIcon: {
    /**
     * ${doc|collection|folder|tag}:${id}
     */
    id: f.string().primaryKey(),
    icon: f.json<IconData>(),
  },
  // Agents shared with everyone in the workspace. The identical table also
  // exists in the userdata schema below for private ones — which table a row
  // lives in *is* its scope, so there's no `scope` column to drift out of sync
  // with where the data actually is. See docs/reference/agents-on-blocks.md.
  agents: agentTable,
} as const satisfies DBSchemaBuilder;
export type NotesGraphWorkspaceDbSchema = typeof NotesGraph_WORKSPACE_DB_SCHEMA;

export type AgentRow = ORMEntity<NotesGraphWorkspaceDbSchema['agents']>;

export type DocProperties = ORMEntity<
  NotesGraphWorkspaceDbSchema['docProperties']
>;
export type DocCustomPropertyInfo = ORMEntity<
  NotesGraphWorkspaceDbSchema['docCustomPropertyInfo']
>;

export const NotesGraph_WORKSPACE_USERDATA_DB_SCHEMA = {
  favorite: {
    key: f.string().primaryKey(),
    index: f.string(),
  },
  settings: {
    key: f.string().primaryKey(),
    value: f.json(),
  },
  docIntegrationRef: {
    // docId as primary key
    id: f.string().primaryKey(),
    type: integrationType,
    /**
     * Identify **notesgraph user** and **integration type** and **integration account**
     * Used to quickly find user's all integrations
     */
    integrationId: f.string(),
    refMeta: f.json(),
  },
  // User-pinned positions of nodes in the document graph view. Stored per-user
  // so each member keeps their own layout; synced to the backend like other
  // userdata (and persisted locally for offline / local workspaces).
  graphNodePosition: {
    // docId as primary key
    id: f.string().primaryKey(),
    x: f.number(),
    y: f.number(),
  },
  // Saved pan/zoom of the document graph view (one row per user, keyed by a
  // constant id). Persisted alongside the pinned positions above.
  graphViewport: {
    id: f.string().primaryKey(),
    x: f.number(),
    y: f.number(),
    k: f.number(),
  },
  // Current child page of a node in the document graph view (docId -> page).
  // Only non-zero pages are stored; page 0 is the default.
  graphNodePage: {
    // docId as primary key
    id: f.string().primaryKey(),
    page: f.number(),
  },
  // Manual sort key for a node among its siblings in the graph (docId -> key).
  // Children are laid out by ascending key (fractional, so new nodes can be
  // inserted between existing ones); unset nodes fall back to their createDate.
  graphNodeSort: {
    // docId as primary key
    id: f.string().primaryKey(),
    key: f.number(),
  },
  // This person's private agents (see `agents` in the workspace schema).
  agents: agentTable,
  // Run history. Userdata rather than workspace on purpose: runs are
  // per-person and high-volume, and a shared table would permanently grow a
  // document every collaborator syncs. Kept small and ring-pruned — full
  // transcripts belong in a blob if they're ever wanted.
  agentRuns: {
    id: f.string().primaryKey().optional().default(nanoid),
    agentId: f.string(),
    /** Denormalized so a run still reads sensibly after the agent is deleted. */
    agentName: f.string(),
    /** 'block' | 'selection' | 'doc' */
    targetKind: f.string(),
    docId: f.string(),
    blockId: f.string().optional(),
    /** 'running' | 'done' | 'cancelled' | 'error' */
    status: f.string(),
    startedAt: f.number(),
    durationMs: f.number().optional(),
    /** Tool-loop steps actually consumed. */
    steps: f.number().optional(),
    /** Short excerpt of the result, for the run list. */
    summary: f.string().optional(),
    error: f.string().optional(),
  },
} as const satisfies DBSchemaBuilder;
export type NotesGraphWorkspaceUserdataDbSchema =
  typeof NotesGraph_WORKSPACE_USERDATA_DB_SCHEMA;
export type DocIntegrationRef = ORMEntity<
  NotesGraphWorkspaceUserdataDbSchema['docIntegrationRef']
>;
export type AgentRunRow = ORMEntity<
  NotesGraphWorkspaceUserdataDbSchema['agentRuns']
>;
