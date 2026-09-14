import { createIdentifier } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/store';

export interface UppyUploadOptions {
  accept?: string;
  multiple?: boolean;
}

export interface UppyUploadService {
  /** Whether a Companion server is configured for this workspace/server. */
  isAvailable: () => boolean;
  openUppyUpload: (options?: UppyUploadOptions) => Promise<File[]>;
}

export const UppyUploadProvider = createIdentifier<UppyUploadService>(
  'NotesGraphUppyUploadService'
);

export function UppyUploadExtension(
  uppyUploadService: UppyUploadService
): ExtensionType {
  return {
    setup: di => {
      di.addImpl(UppyUploadProvider, uppyUploadService);
    },
  };
}
