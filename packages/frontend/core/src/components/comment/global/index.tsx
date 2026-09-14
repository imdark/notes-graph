import { AddCommentIcon } from '@blocksuite/icons/rc';
import type { Store } from '@blocksuite/notesgraph/store';
import { Button } from '@notesgraph/component';
import { ServerService } from '@notesgraph/core/modules/cloud';
import type { DocCommentEntity } from '@notesgraph/core/modules/comment/entities/doc-comment';
import { DocCommentManagerService } from '@notesgraph/core/modules/comment/services/doc-comment-manager';
import { DocService } from '@notesgraph/core/modules/doc';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { ServerFeature } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAsyncCallback } from '../../hooks/notesgraph-async-hooks';
import { CommentItem, CommentRow, useCommentAccount } from '../sidebar';
import * as styles from './index.css';

/**
 * Acquire the (pooled, ref-counted) comment entity for `docId` and keep it
 * started while mounted. Mirrors the sidebar's `useCommentEntity` minus the
 * sidebar-only pending-comment auto-open. Because `start()/stop()` are
 * ref-counted on the entity, this coexists safely with the sidebar.
 */
const useGlobalCommentEntity = (docId: string | undefined) => {
  const manager = useService(DocCommentManagerService);
  const [entity, setEntity] = useState<DocCommentEntity | null>(null);

  useEffect(() => {
    if (!docId) {
      return;
    }
    const entityRef = manager.get(docId);
    setEntity(entityRef.obj);
    entityRef.obj.start();
    return () => {
      entityRef.obj.stop();
      entityRef.release();
    };
  }, [manager, docId]);

  return entity;
};

const GlobalCommentsInner = ({ entity }: { entity: DocCommentEntity }) => {
  const t = useI18n();
  const comments = useLiveData(entity.comments$);
  const account = useCommentAccount();
  const [draftDoc, setDraftDoc] = useState<Store | null>(null);

  // "Global" comments are page-level: they carry no `preview` (inline
  // comments always quote the anchored text/block).
  const globalComments = useMemo(
    () =>
      comments
        .filter(comment => !comment.content?.preview)
        .toSorted((a, b) => a.createdAt - b.createdAt),
    [comments]
  );

  const handleOpen = useAsyncCallback(async () => {
    const doc = await entity.createDraftDoc();
    if (doc) {
      setDraftDoc(doc);
    }
  }, [entity]);

  const handleCommit = useAsyncCallback(async () => {
    if (!draftDoc) return;
    await entity.addGlobalComment(draftDoc);
    setDraftDoc(null);
  }, [entity, draftDoc]);

  const handleCancel = useCallback(() => {
    setDraftDoc(null);
  }, []);

  return (
    <section className={styles.container} data-testid="doc-global-comments">
      <div className={styles.title}>
        {t['com.notesgraph.comment.comments']()}
      </div>
      <div className={styles.list}>
        {globalComments.map(comment => (
          <CommentItem key={comment.id} comment={comment} entity={entity} />
        ))}
        {globalComments.length === 0 && !draftDoc && (
          <div className={styles.empty}>
            {t['com.notesgraph.comment.no-comments']()}
          </div>
        )}
      </div>
      {draftDoc ? (
        <CommentRow
          user={{
            avatarUrl: account?.avatar ?? null,
            name: account?.label ?? '',
          }}
          doc={draftDoc}
          autoFocus
          onCommit={handleCommit}
          onCancel={handleCancel}
        />
      ) : (
        <Button
          className={styles.addButton}
          variant="secondary"
          prefix={<AddCommentIcon />}
          onClick={handleOpen}
        >
          {t['com.notesgraph.comment.add-global-comment']()}
        </Button>
      )}
    </section>
  );
};

/**
 * A page-level comment thread rendered at the bottom of the document (like the
 * backlinks panel). Shows "global" comments — those not anchored to a text
 * selection — and lets you add one. Gated the same way as inline comments:
 * cloud workspaces need the server Comment feature; local workspaces use the
 * local DB-backed comment store.
 */
export const DocGlobalComments = () => {
  const doc = useServiceOptional(DocService)?.doc;
  const workspaceService = useService(WorkspaceService);
  const serverService = useService(ServerService);
  const serverConfig = useLiveData(serverService.server.config$);
  const entity = useGlobalCommentEntity(doc?.id);

  const isLocal = workspaceService.workspace.flavour === 'local';
  const enabled =
    isLocal || serverConfig.features.includes(ServerFeature.Comment);

  if (!doc || !enabled || !entity) {
    return null;
  }

  return <GlobalCommentsInner entity={entity} />;
};
