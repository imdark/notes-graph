import { Button, toast } from '@notesgraph/component';
import {
  AuthService,
  WorkspaceServerService,
} from '@notesgraph/core/modules/cloud';
import { SnapshotHelper } from '@notesgraph/core/modules/comment/services/snapshot-helper';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import { DocService } from '@notesgraph/core/modules/doc';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import {
  createAnonymousCommentMutation,
  publicDocCommentsQuery,
} from '@notesgraph/graphql';
import { useLiveData, useService, useServiceOptional } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import { DocGlobalComments } from '../../components/comment/global';

interface PublicComment {
  id: string;
  author: string;
  createdAt: string;
  text: string;
}

/** Pull readable text out of a comment's DocSnapshot content. */
function snapshotText(content: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    const delta = (obj.text as Record<string, unknown> | undefined)?.delta;
    if (Array.isArray(delta)) {
      for (const d of delta) {
        const insert = (d as { insert?: unknown }).insert;
        if (typeof insert === 'string') out.push(insert);
      }
    }
    if (Array.isArray(obj.children)) obj.children.forEach(walk);
    if (obj.blocks) walk(obj.blocks);
    if (obj.props) walk(obj.props);
  };
  walk(content);
  return out.join(' ').trim();
}

const AnonymousComments = ({ onSignIn }: { onSignIn: () => void }) => {
  const workspaceService = useService(WorkspaceService);
  const docService = useService(DocService);
  const workspaceServerService = useService(WorkspaceServerService);
  const snapshotHelper = useService(SnapshotHelper);

  const [comments, setComments] = useState<PublicComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const workspaceId = workspaceService.workspace.id;
  const docId = docService.doc.id;

  useEffect(() => {
    const server = workspaceServerService.server;
    if (!server) return;
    let cancelled = false;
    server
      .gql({
        query: publicDocCommentsQuery,
        variables: { workspaceId, docId, pagination: { first: 100 } },
      })
      .then(res => {
        if (cancelled) return;
        const items = res.publicDocComments.edges.map(({ node }) => ({
          id: node.id,
          author: node.user?.name ?? 'Anonymous',
          createdAt: node.createdAt as string,
          text: snapshotText(node.content),
        }));
        setComments(items);
      })
      .catch(err => {
        console.error('[shared-comments] list failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceServerService.server, workspaceId, docId, reloadKey]);

  const post = useCallback(async () => {
    const text = draft.trim();
    const server = workspaceServerService.server;
    if (!text || !server) return;
    setBusy(true);
    try {
      const store = await snapshotHelper.createStore();
      if (!store) throw new Error('failed to create comment store');
      const [paragraph] = store.getBlocksByFlavour('notesgraph:paragraph');
      const model = paragraph?.model as
        | { text?: { insert: (s: string, i: number) => void } }
        | undefined;
      model?.text?.insert(text, 0);
      const snapshot = snapshotHelper.getSnapshot(store);
      if (!snapshot) throw new Error('failed to snapshot comment');

      await server.gql({
        query: createAnonymousCommentMutation,
        variables: {
          input: { workspaceId, docId, content: snapshot as object },
        },
      });
      setDraft('');
      setReloadKey(k => k + 1);
      toast('Comment posted');
    } catch (err) {
      console.error('[shared-comments] post failed:', err);
      toast('Could not post the comment');
    } finally {
      setBusy(false);
    }
  }, [
    draft,
    workspaceServerService.server,
    snapshotHelper,
    workspaceId,
    docId,
  ]);

  return (
    <div
      style={{
        borderTop: '1px solid rgba(128,128,128,0.2)',
        marginTop: 24,
        paddingTop: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      data-testid="shared-page-anonymous-comments"
    >
      <div style={{ fontWeight: 600 }}>Comments</div>
      {comments.map(c => (
        <div key={c.id} style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 12, opacity: 0.65 }}>
            {c.author} · {new Date(c.createdAt).toLocaleString()}
          </span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{c.text}</span>
        </div>
      ))}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Write a comment…"
        rows={3}
        style={{
          resize: 'vertical',
          padding: 8,
          borderRadius: 6,
          border: '1px solid rgba(128,128,128,0.35)',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button
          variant="primary"
          disabled={busy || !draft.trim()}
          onClick={() => {
            void post();
          }}
        >
          Post anonymously
        </Button>
        <span style={{ opacity: 0.6, fontSize: 13 }}>or</span>
        <Button variant="secondary" onClick={onSignIn}>
          Sign in to comment with your name
        </Button>
      </div>
    </div>
  );
};

/**
 * Comments on a shared (public) page whose link grants read + comment.
 * Signed-in visitors get the full comment section; anonymous visitors can
 * post as "Anonymous" or sign in to comment under their own name.
 */
export const SharedPageComments = () => {
  const authService = useServiceOptional(AuthService);
  const globalDialogService = useService(GlobalDialogService);
  const status = useLiveData(authService?.session.status$);

  const signIn = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  if (!authService) return null;

  if (status !== 'authenticated') {
    return <AnonymousComments onSignIn={signIn} />;
  }

  return <DocGlobalComments />;
};
