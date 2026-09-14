import type { Meta, UppyFile } from '@uppy/core';

import { RELAY_TOKEN_META_KEY } from './create-uppy';
import { fetchRelayResult } from './relay-client';

/**
 * Turns Uppy's successful-upload results back into real `File`s: local
 * files already carry their Blob in `.data`; files that went through the
 * relay (see `createNotesGraphUppy`) are fetched back down by their token.
 */
export async function resolveUppyFiles(
  serverBaseUrl: string,
  successful: UppyFile<Meta, Record<string, never>>[]
): Promise<File[]> {
  const files = await Promise.all(
    successful.map(async file => {
      const relayToken = file.meta[RELAY_TOKEN_META_KEY] as string | undefined;
      if (relayToken) {
        const blob = await fetchRelayResult(serverBaseUrl, relayToken);
        return new File([blob], file.name ?? 'file', {
          type: blob.type || file.type,
        });
      }
      if (file.data instanceof File) {
        return file.data;
      }
      if (file.data instanceof Blob) {
        return new File([file.data], file.name ?? 'file', {
          type: file.data.type || file.type,
        });
      }
      return null;
    })
  );
  return files.filter((file): file is File => !!file);
}
