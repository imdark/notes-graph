import { Uppy } from '@uppy/core';
import Dropbox from '@uppy/dropbox';
import GoogleDrive from '@uppy/google-drive';
import XHRUpload from '@uppy/xhr-upload';

import { mintRelayToken, relayEndpoint } from './relay-client';

/** Key stashed on `file.meta` for files relayed through `/api/uppy-relay`. */
export const RELAY_TOKEN_META_KEY = 'relayToken';

export type NotesGraphUppy = Uppy;

export interface CreateUppyOptions {
  /** Base url of the backend server this workspace/account talks to. */
  serverBaseUrl: string;
  /** Uppy Companion url from `serverConfig.companionUrl`; omit/null disables remote sources. */
  companionUrl?: string | null;
  accept?: string;
  multiple?: boolean;
}

/**
 * Builds an Uppy instance for the shared upload dialog. When `companionUrl`
 * is configured, every added file (local or remote) is routed through
 * `@uppy/xhr-upload` to our `/api/uppy-relay` endpoint — Companion can only
 * stream remote-source files server-to-server, so this keeps local and
 * remote files on one uniform path instead of branching per file. When
 * `companionUrl` is absent (no Companion configured, or a fully local-only
 * workspace with no backend at all), no plugins beyond the Dashboard are
 * installed and local files never leave the browser.
 */
export function createNotesGraphUppy({
  serverBaseUrl,
  companionUrl,
  accept,
  multiple = true,
}: CreateUppyOptions): NotesGraphUppy {
  const uppy = new Uppy({
    restrictions: {
      allowedFileTypes: accept
        ? accept.split(',').map(type => type.trim())
        : null,
      maxNumberOfFiles: multiple ? null : 1,
    },
  });

  if (companionUrl) {
    uppy.use(GoogleDrive, { companionUrl });
    uppy.use(Dropbox, { companionUrl });
    uppy.use(XHRUpload, {
      endpoint: async fileOrBundle => {
        // `bundle` defaults to false, so this is always a single file.
        const file = Array.isArray(fileOrBundle)
          ? fileOrBundle[0]
          : fileOrBundle;
        const token = await mintRelayToken(serverBaseUrl);
        uppy.setFileMeta(file.id, { [RELAY_TOKEN_META_KEY]: token });
        return relayEndpoint(serverBaseUrl, token);
      },
      formData: false,
      method: 'POST',
      limit: 3,
    });
  }

  return uppy;
}
