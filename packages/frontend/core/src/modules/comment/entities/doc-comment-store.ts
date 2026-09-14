import {
  createCommentMutation,
  createReplyMutation,
  deleteCommentMutation,
  deleteReplyMutation,
  type DocMode,
  type ListCommentsQuery,
  listCommentsQuery,
  resolveCommentMutation,
  updateCommentMutation,
  updateReplyMutation,
  uploadCommentAttachmentMutation,
} from '@notesgraph/graphql';
import { Entity } from '@notesgraph/infra';
import type {
  RealtimeSubscriptionReady,
  RealtimeTopicEventOf,
} from '@notesgraph/realtime';
import { nanoid } from 'nanoid';
import { combineLatest, map, NEVER, type Observable } from 'rxjs';

import type { DefaultServerService, WorkspaceServerService } from '../../cloud';
import { AuthService } from '../../cloud/services/auth';
import { GraphQLService } from '../../cloud/services/graphql';
import type { WorkspaceDBService } from '../../db';
import type { NbstoreService } from '../../storage';
import type { WorkspaceService } from '../../workspace';
import type {
  DocComment,
  DocCommentChangeListResult,
  DocCommentContent,
  DocCommentListResult,
  DocCommentReply,
} from '../types';
import { findMentions } from './utils';

interface LocalCommentRow {
  id: string;
  docId: string;
  content: unknown;
  resolved?: boolean | null;
  userId?: string | null;
  userName?: string | null;
  userAvatar?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LocalReplyRow {
  id: string;
  commentId: string;
  content: unknown;
  userId?: string | null;
  userName?: string | null;
  userAvatar?: string | null;
  createdAt: number;
  updatedAt: number;
}

type GQLCommentType =
  ListCommentsQuery['workspace']['comments']['edges'][number]['node'];
type GQLReplyType = GQLCommentType['replies'][number];
type GQLUserType = GQLCommentType['user'];

// Helper functions for normalizing backend responses
const normalizeUser = (user: GQLUserType) => ({
  id: user.id,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

const normalizeReply = (reply: GQLReplyType): DocCommentReply => ({
  id: reply.id,
  commentId: reply.commentId,
  content: reply.content as DocCommentContent,
  createdAt: new Date(reply.createdAt).getTime(),
  updatedAt: new Date(reply.updatedAt).getTime(),
  user: normalizeUser(reply.user),
  mentions: findMentions(reply.content.snapshot.blocks),
});

const normalizeComment = (comment: GQLCommentType): DocComment => ({
  id: comment.id,
  content: comment.content ? (comment.content as DocCommentContent) : undefined,
  resolved: comment.resolved,
  createdAt: new Date(comment.createdAt).getTime(),
  updatedAt: new Date(comment.updatedAt).getTime(),
  user: comment.user
    ? normalizeUser(comment.user)
    : {
        id: '',
        name: '',
        avatarUrl: '',
      },
  mentions: comment.content
    ? findMentions(comment.content.snapshot.blocks)
    : [],
  replies: comment.replies?.map(normalizeReply) ?? [],
});

export class DocCommentStore extends Entity<{
  docId: string;
  getDocMode: () => DocMode;
  getDocTitle: () => string;
}> {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly defaultServerService: DefaultServerService,
    private readonly nbstoreService: NbstoreService,
    private readonly workspaceDBService: WorkspaceDBService
  ) {
    super();
  }

  /**
   * Local (offline) workspaces have no comment server; fall back to the
   * workspace's local DB tables. Mirrors the projects local backend.
   */
  get isLocal() {
    return (
      this.workspaceService.workspace.flavour === 'local' ||
      !this.serverService
    );
  }

  private get serverService() {
    return (
      this.workspaceServerService.server || this.defaultServerService.server
    );
  }

  private get graphqlService() {
    return this.serverService?.scope.get(GraphQLService);
  }

  private get currentWorkspaceId() {
    return this.workspaceService.workspace.id;
  }

  private get commentsTable() {
    return this.workspaceDBService.db.comments;
  }

  private get repliesTable() {
    return this.workspaceDBService.db.commentReplies;
  }

  /** Best-effort author for a locally-authored comment. */
  private localUser() {
    const account = this.serverService?.scope.get(AuthService)?.session.account$
      .value;
    return account
      ? { id: account.id, name: account.label, avatarUrl: account.avatar ?? '' }
      : { id: 'local', name: 'You', avatarUrl: '' };
  }

  private rowToReply(row: LocalReplyRow): DocCommentReply {
    const content = row.content as DocCommentContent;
    return {
      id: row.id,
      commentId: row.commentId,
      content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: {
        id: row.userId ?? '',
        name: row.userName ?? '',
        avatarUrl: row.userAvatar ?? '',
      },
      mentions: content?.snapshot ? findMentions(content.snapshot.blocks) : [],
    };
  }

  private rowToComment(
    row: LocalCommentRow,
    replies: DocCommentReply[]
  ): DocComment {
    const content = row.content as DocCommentContent;
    return {
      id: row.id,
      content,
      resolved: !!row.resolved,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: {
        id: row.userId ?? '',
        name: row.userName ?? '',
        avatarUrl: row.userAvatar ?? '',
      },
      mentions: content?.snapshot ? findMentions(content.snapshot.blocks) : [],
      replies,
    };
  }

  /** Reactive local comment list (used instead of realtime on local). */
  watchComments(): Observable<DocComment[]> {
    return combineLatest([
      this.commentsTable.find$({ docId: this.props.docId }),
      this.repliesTable.find$(),
    ]).pipe(
      map(([comments, replies]) => {
        const byComment = new Map<string, LocalReplyRow[]>();
        for (const reply of replies as LocalReplyRow[]) {
          const list = byComment.get(reply.commentId) ?? [];
          list.push(reply);
          byComment.set(reply.commentId, list);
        }
        return (comments as LocalCommentRow[])
          .map(comment =>
            this.rowToComment(
              comment,
              (byComment.get(comment.id) ?? [])
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(reply => this.rowToReply(reply))
            )
          )
          .sort((a, b) => a.createdAt - b.createdAt);
      })
    );
  }

  async listComments({
    after,
  }: {
    after?: string;
  }): Promise<DocCommentListResult> {
    if (this.isLocal) {
      const comments = this.commentsTable.find({
        docId: this.props.docId,
      }) as LocalCommentRow[];
      const replies = this.repliesTable.find() as LocalReplyRow[];
      const byComment = new Map<string, LocalReplyRow[]>();
      for (const reply of replies) {
        const list = byComment.get(reply.commentId) ?? [];
        list.push(reply);
        byComment.set(reply.commentId, list);
      }
      return {
        comments: comments
          .map(comment =>
            this.rowToComment(
              comment,
              (byComment.get(comment.id) ?? [])
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(reply => this.rowToReply(reply))
            )
          )
          .sort((a, b) => a.createdAt - b.createdAt),
        hasNextPage: false,
        startCursor: '',
        endCursor: '',
      };
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }
    const response = await graphql.gql({
      query: listCommentsQuery,
      variables: {
        pagination: {
          after,
        },
        workspaceId: this.currentWorkspaceId,
        docId: this.props.docId,
      },
    });

    const comments = response.workspace?.comments;
    if (!comments) {
      return {
        comments: [],
        hasNextPage: false,
        startCursor: '',
        endCursor: '',
      };
    }

    return {
      comments: comments.edges.map(edge => normalizeComment(edge.node)),
      hasNextPage: comments.pageInfo.hasNextPage,
      startCursor: comments.pageInfo.startCursor || '',
      endCursor: comments.pageInfo.endCursor || '',
    };
  }

  async listCommentChanges({
    after,
  }: {
    after?: string;
  }): Promise<DocCommentChangeListResult> {
    if (this.isLocal) {
      // Local reactivity comes from `watchComments()`, not a change feed.
      return {
        changes: [],
        startCursor: '',
        endCursor: '',
        hasNextPage: false,
      };
    }
    const commentChanges = await this.nbstoreService.realtime.request(
      'comment.changes.get',
      { after, workspaceId: this.currentWorkspaceId, docId: this.props.docId }
    );
    return {
      changes: commentChanges.changes.map(change => ({
        id: change.id,
        action:
          change.action as DocCommentChangeListResult['changes'][number]['action'],
        comment: normalizeComment(change.item as GQLCommentType),
        commentId: change.commentId ?? undefined,
      })),
      startCursor: commentChanges.startCursor,
      endCursor: commentChanges.endCursor,
      hasNextPage: commentChanges.hasNextPage,
    };
  }

  subscribeCommentChanged(): Observable<
    RealtimeTopicEventOf<'comment.changed'> | RealtimeSubscriptionReady
  > {
    if (this.isLocal) {
      // No realtime channel locally; the entity uses `watchComments()`.
      return NEVER;
    }
    return this.nbstoreService.realtime.subscribe('comment.changed', {
      workspaceId: this.currentWorkspaceId,
      docId: this.props.docId,
    });
  }

  async createComment(commentInput: {
    content: DocCommentContent;
    mentions?: string[];
  }): Promise<DocComment> {
    if (this.isLocal) {
      const now = Date.now();
      const user = this.localUser();
      const row = this.commentsTable.create({
        id: nanoid(),
        docId: this.props.docId,
        content: commentInput.content,
        resolved: false,
        userId: user.id,
        userName: user.name,
        userAvatar: user.avatarUrl,
        createdAt: now,
        updatedAt: now,
      }) as LocalCommentRow;
      return this.rowToComment(row, []);
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    const mentions = commentInput.mentions;

    const response = await graphql.gql({
      query: createCommentMutation,
      variables: {
        input: {
          workspaceId: this.currentWorkspaceId,
          docId: this.props.docId,
          docMode: this.props.getDocMode(),
          docTitle: this.props.getDocTitle(),
          content: commentInput.content,
          mentions,
        },
      },
    });

    const comment = response.createComment;
    return normalizeComment(comment);
  }

  async updateComment(
    commentId: string,
    commentInput: {
      content: DocCommentContent;
    }
  ): Promise<void> {
    if (this.isLocal) {
      this.commentsTable.update(commentId, {
        content: commentInput.content,
        updatedAt: Date.now(),
      });
      return;
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    await graphql.gql({
      query: updateCommentMutation,
      variables: {
        input: {
          id: commentId,
          content: commentInput.content,
        },
      },
    });
  }

  async resolveComment(commentId: string, resolved = true): Promise<boolean> {
    if (this.isLocal) {
      this.commentsTable.update(commentId, {
        resolved,
        updatedAt: Date.now(),
      });
      return resolved;
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    const response = await graphql.gql({
      query: resolveCommentMutation,
      variables: {
        input: {
          id: commentId,
          resolved,
        },
      },
    });

    return response.resolveComment;
  }

  async deleteComment(commentId: string): Promise<boolean> {
    if (this.isLocal) {
      for (const reply of this.repliesTable.find({
        commentId,
      }) as LocalReplyRow[]) {
        this.repliesTable.delete(reply.id);
      }
      this.commentsTable.delete(commentId);
      return true;
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    const response = await graphql.gql({
      query: deleteCommentMutation,
      variables: {
        id: commentId,
      },
    });
    return response.deleteComment;
  }

  async createReply(
    commentId: string,
    replyInput: {
      content: DocCommentContent;
      mentions?: string[];
    }
  ): Promise<DocCommentReply> {
    if (this.isLocal) {
      const now = Date.now();
      const user = this.localUser();
      const row = this.repliesTable.create({
        id: nanoid(),
        commentId,
        content: replyInput.content,
        userId: user.id,
        userName: user.name,
        userAvatar: user.avatarUrl,
        createdAt: now,
        updatedAt: now,
      }) as LocalReplyRow;
      // Bump the parent so its `updatedAt` reflects thread activity.
      this.commentsTable.update(commentId, { updatedAt: now });
      return this.rowToReply(row);
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    const response = await graphql.gql({
      query: createReplyMutation,
      variables: {
        input: {
          commentId,
          content: replyInput.content,
          docMode: this.props.getDocMode(),
          docTitle: this.props.getDocTitle(),
          mentions: replyInput.mentions,
        },
      },
    });
    return normalizeReply(response.createReply);
  }

  async updateReply(
    replyId: string,
    replyInput: {
      content: DocCommentContent;
    }
  ): Promise<void> {
    if (this.isLocal) {
      this.repliesTable.update(replyId, {
        content: replyInput.content,
        updatedAt: Date.now(),
      });
      return;
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    await graphql.gql({
      query: updateReplyMutation,
      variables: {
        input: {
          id: replyId,
          content: replyInput.content,
        },
      },
    });
  }

  async deleteReply(replyId: string): Promise<void> {
    if (this.isLocal) {
      this.repliesTable.delete(replyId);
      return;
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    await graphql.gql({
      query: deleteReplyMutation,
      variables: {
        id: replyId,
      },
    });
  }

  /**
   * Upload a comment attachment blob and obtain the remote URL.
   * @param file File (image/blob) selected by user
   * @returns url string returned by server
   */
  uploadCommentAttachment = async (file: File): Promise<string> => {
    if (this.isLocal) {
      // Persist into the workspace blob store and hand back an object URL for
      // immediate display. (Cloud returns a durable server URL; a local blob
      // URL is session-scoped, which is acceptable for offline comments.)
      const key = nanoid();
      await this.workspaceService.workspace.engine.blob.set({
        key,
        data: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
      });
      return URL.createObjectURL(file);
    }
    const graphql = this.graphqlService;
    if (!graphql) {
      throw new Error('GraphQL service not found');
    }

    const res = await graphql.gql({
      timeout: 180_000,
      query: uploadCommentAttachmentMutation,
      variables: {
        workspaceId: this.currentWorkspaceId,
        docId: this.props.docId,
        attachment: file,
      },
    });
    return res.uploadCommentAttachment;
  };
}
