import { type DocMode, DocModes } from '@blocksuite/notesgraph/model';
import { UserFriendlyError } from '@notesgraph/error';
import { TimeoutError } from 'rxjs';

export const getResolvedPublishMode = (
  queryMode: DocMode | null,
  publishMode?: DocMode | null
): DocMode => {
  if (queryMode && DocModes.includes(queryMode)) {
    return queryMode;
  }

  return publishMode === 'edgeless' ? 'edgeless' : 'page';
};

export const parsePublishMode = (
  publishMode: string | null | undefined
): DocMode | null => {
  if (!publishMode) {
    return null;
  }

  return DocModes.includes(publishMode as DocMode)
    ? (publishMode as DocMode)
    : null;
};

export interface SharedPublishInfo {
  mode: DocMode | null;
  /** true when the share link grants read + comment ('commenter' role) */
  commentable: boolean;
}

const parseCommentable = (res: Response) =>
  res.headers.get('public-role') === 'commenter';

export const fetchSharedPublishMode = async ({
  serverBaseUrl,
  workspaceId,
  docId,
  signal,
}: {
  serverBaseUrl: string;
  workspaceId: string;
  docId: string;
  signal?: AbortSignal;
}): Promise<SharedPublishInfo> => {
  const url = new URL(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/public-docs/${encodeURIComponent(docId)}`,
    serverBaseUrl
  );
  const headers = {
    Accept: 'application/octet-stream',
    'x-notesgraph-version': BUILD_CONFIG.appVersion,
  };
  const headResponse = await globalThis.fetch(url, {
    method: 'HEAD',
    headers,
    signal,
  });
  const headMode = parsePublishMode(headResponse.headers.get('publish-mode'));

  if (headMode || headResponse.status === 404 || !headResponse.ok) {
    return { mode: headMode, commentable: parseCommentable(headResponse) };
  }

  const getResponse = await globalThis.fetch(url, {
    headers,
    signal,
  });
  try {
    return {
      mode: parsePublishMode(getResponse.headers.get('publish-mode')),
      commentable: parseCommentable(getResponse),
    };
  } finally {
    await getResponse.body?.cancel();
  }
};

export const getSearchWithMode = (search: string, mode: DocMode) => {
  const searchParams = new URLSearchParams(search);
  searchParams.set('mode', mode);

  const nextSearch = searchParams.toString();
  return nextSearch ? `?${nextSearch}` : '';
};

export const isSharePagePermissionError = (error: unknown) =>
  error instanceof UserFriendlyError &&
  (error.isStatus(403) ||
    error.name === 'DOC_ACTION_DENIED' ||
    error.name === 'SPACE_ACCESS_DENIED');

export const isSharePageTimeoutError = (error: unknown) =>
  error instanceof TimeoutError;
