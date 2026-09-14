import { Button, ErrorMessage, notify, Skeleton } from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import {
  AccessTokenService,
  ServerService,
} from '@notesgraph/core/modules/cloud';
import type { AccessToken } from '@notesgraph/core/modules/cloud/stores/access-token';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { UserFriendlyError } from '@notesgraph/error';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { IntegrationSettingHeader } from '../setting';
import MCPIcon from './MCP.inline.svg';
import * as styles from './setting-panel.css';

export const McpServerSettingPanel = () => {
  return <McpServerSetting />;
};

const McpServerSettingHeader = ({ action }: { action?: ReactNode }) => {
  const t = useI18n();

  return (
    <IntegrationSettingHeader
      icon={<img src={MCPIcon} />}
      name={t['com.notesgraph.integration.mcp-server.name']()}
      desc={t['com.notesgraph.integration.mcp-server.desc']()}
      action={action}
    />
  );
};

const McpServerSetting = () => {
  const workspaceService = useService(WorkspaceService);
  const serverService = useService(ServerService);
  const workspaceName = useLiveData(workspaceService.workspace.name$);
  const accessTokenService = useService(AccessTokenService);
  const accessTokens = useLiveData(accessTokenService.accessTokens$);
  const isRevalidating = useLiveData(accessTokenService.isRevalidating$);
  const error = useLiveData(accessTokenService.error$);
  const [mutating, setMutating] = useState(false);
  const [revealedAccessToken, setRevealedAccessToken] =
    useState<AccessToken | null>(null);
  const t = useI18n();

  const mcpAccessToken = useMemo(() => {
    return accessTokens?.find(token => token.name === 'mcp');
  }, [accessTokens]);

  const hasMcpToken = Boolean(revealedAccessToken || mcpAccessToken);
  const hasCopyableToken = Boolean(revealedAccessToken);
  const isRedactedDisplay = hasMcpToken && !hasCopyableToken;

  const code = useMemo(() => {
    return revealedAccessToken
      ? JSON.stringify(
          {
            mcpServers: {
              [`notesgraph_workspace_${workspaceService.workspace.id}`]: {
                type: 'streamable-http',
                url: `${serverService.server.baseUrl}/api/workspaces/${workspaceService.workspace.id}/mcp`,
                note: `Read docs from NotesGraph workspace "${workspaceName}"`,
                headers: {
                  Authorization: `Bearer ${revealedAccessToken.token}`,
                },
              },
            },
          },
          null,
          2
        )
      : null;
  }, [revealedAccessToken, workspaceName, workspaceService, serverService]);

  const copyJsonDisabled = !code || mutating || isRedactedDisplay;
  const copyJsonTooltip = isRedactedDisplay
    ? t['com.notesgraph.integration.mcp-server.copy-json.disabled-hint']()
    : undefined;

  const showLoading = accessTokens === null && isRevalidating;
  const showError = accessTokens === null && error !== null;

  useEffect(() => {
    accessTokenService.revalidate();
  }, [accessTokenService]);

  const handleGenerateAccessToken = useAsyncCallback(async () => {
    setMutating(true);
    try {
      if (mcpAccessToken) {
        await accessTokenService.revokeUserAccessToken(mcpAccessToken.id);
      }
      const createdToken =
        await accessTokenService.generateUserAccessToken('mcp');
      setRevealedAccessToken(createdToken);
    } catch (err) {
      notify.error({
        error: UserFriendlyError.fromAny(err),
      });
    } finally {
      setMutating(false);
    }
  }, [accessTokenService, mcpAccessToken]);

  const handleRevokeAccessToken = useAsyncCallback(async () => {
    setMutating(true);
    try {
      if (mcpAccessToken) {
        await accessTokenService.revokeUserAccessToken(mcpAccessToken.id);
      }
      setRevealedAccessToken(null);
    } catch (err) {
      notify.error({
        error: UserFriendlyError.fromAny(err),
      });
    } finally {
      setMutating(false);
    }
  }, [accessTokenService, mcpAccessToken]);

  if (showLoading) {
    return (
      <div>
        <McpServerSettingHeader />
        <Skeleton />
      </div>
    );
  }

  if (showError) {
    return (
      <div>
        <McpServerSettingHeader />
        <ErrorMessage>{error}</ErrorMessage>
      </div>
    );
  }

  return (
    <div>
      <McpServerSettingHeader />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Personal access token</div>
          {!hasMcpToken ? (
            <Button
              variant="primary"
              onClick={handleGenerateAccessToken}
              disabled={mutating}
            >
              Create New
            </Button>
          ) : (
            <Button
              variant="error"
              onClick={handleRevokeAccessToken}
              disabled={mutating}
            >
              Delete
            </Button>
          )}
        </div>
        <p className={styles.sectionDescription}>
          This access token is used for the MCP service, please keep this
          information secure. Deleting it will invalidate the access token.
        </p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Server Config</div>
          <Button
            variant="primary"
            onClick={() => {
              if (!code) return;
              // oxlint-disable-next-line @typescript-eslint/no-floating-promises
              navigator.clipboard.writeText(code);
              notify.success({
                title: t['Copied to clipboard'](),
              });
            }}
            disabled={copyJsonDisabled}
            tooltip={copyJsonTooltip}
          >
            Copy json
          </Button>
        </div>
        {code ? (
          <pre className={styles.preArea}>{code}</pre>
        ) : (
          <p
            className={styles.sectionDescription}
            style={{ textAlign: 'center' }}
          >
            No access token found, please generate one first.
          </p>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Support tools</div>
        </div>
        <br />

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>doc-read</div>
          </div>
          <div className={styles.sectionDescription}>
            Return the complete text and basic metadata of a single document
            identified by docId; use this when the user needs the full content
            of a specific file rather than a search result.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>doc-semantic-search</div>
          </div>
          <div className={styles.sectionDescription}>
            Retrieve conceptually related passages by performing vector-based
            semantic similarity search across embedded documents; use this tool
            only when exact keyword search fails or the user explicitly needs
            meaning-level matches (e.g., paraphrases, synonyms, broader
            concepts, recent documents). Accepts an optional docId to scope
            matching to a single document.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>doc-keyword-search</div>
          </div>
          <div className={styles.sectionDescription}>
            Fuzzy search all workspace documents for the exact keyword or phrase
            supplied and return matching documents ranked by textual match. Use
            this tool by default whenever a straightforward term-based or
            keyword-base lookup is sufficient.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>search-blocks</div>
          </div>
          <div className={styles.sectionDescription}>
            Full-text search over individual blocks (paragraphs, list items,
            headings) returning blockId-level hits with their text — pinpoints
            the matching block rather than just the document. Accepts an
            optional docId to search inside a single document.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>list-documents</div>
          </div>
          <div className={styles.sectionDescription}>
            List documents in the workspace (id, title, timestamps),
            newest-updated first — a starting point for exploring the graph
            without a search query.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>list-blocks</div>
          </div>
          <div className={styles.sectionDescription}>
            Query individual task blocks (todo items) across the workspace
            by inline #tags, #key:value properties and org status — the
            block-level equivalent of list-documents, powering AI task
            pickup from query boards. Accepts an optional docId to scope the
            query to a single document.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>get-board</div>
          </div>
          <div className={styles.sectionDescription}>
            Read the virtual kanban/table boards defined in a document — each
            board&apos;s saved query scope (#tags, #key:value props, status
            slice, due-within bound). Agents combine the scope with
            list-blocks to fetch the board&apos;s tasks.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>update-task</div>
          </div>
          <div className={styles.sectionDescription}>
            Act on one task block without rewriting the document: set its org
            status (in-progress stamps STARTED and claims with @agent, done
            stamps CLOSED) and/or append a signed progress note under the
            task. Applied as a surgical CRDT delta, safe alongside concurrent
            editors. Available when write tools are enabled.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>update-block</div>
          </div>
          <div className={styles.sectionDescription}>
            Replace the text of one specific block without rewriting the
            whole document — a surgical CRDT edit, stamped with the standard
            &quot;Edited via MCP&quot; attribution. Available when write
            tools are enabled.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>get-backlinks</div>
          </div>
          <div className={styles.sectionDescription}>
            List documents that link to a given document — its parents in the
            graph (a doc can have several).
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>get-links</div>
          </div>
          <div className={styles.sectionDescription}>
            List documents a given document links to — its children/references.
            Use with get-backlinks to walk the graph outward from a starting
            document.
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              create-document, update-document, update-document-meta,
              link-document
            </div>
          </div>
          <div className={styles.sectionDescription}>
            Create and edit documents, and link one document under another as
            a real graph reference (not a plain-text link) — additive only,
            never removes or replaces existing content or links. Every write
            appends an &quot;Edited via MCP by &lt;agent&gt;&quot; stamp so
            AI edits stay attributed in the document and its history, and
            AI agents can work kanban task lists through org-mode
            annotations ([ ]/[-]/[X], SCHEDULED/DEADLINE/STARTED/CLOSED)
            without touching board blocks. Enabled only when this server has
            MCP write tools turned on.
          </div>
        </div>
      </div>
    </div>
  );
};
