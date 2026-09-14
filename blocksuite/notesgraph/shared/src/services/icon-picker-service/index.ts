import { createIdentifier } from '@blocksuite/global/di';
import type { UniComponent } from '@blocksuite/notesgraph-shared/types';
export enum IconType {
  Emoji = 'emoji',
  NotesGraphIcon = 'notesgraph-icon',
  Blob = 'blob',
}

export type IconData =
  | {
      type: IconType.Emoji;
      unicode: string;
    }
  | {
      type: IconType.NotesGraphIcon;
      name: string;
      color: string;
    }
  | {
      type: IconType.Blob;
      /**
       * Self-contained data: URL (small raster icons, e.g. AI-generated) —
       * kept in sync with @notesgraph/component's IconData.
       */
      url: string;
    };

export interface IconPickerService {
  iconPickerComponent: UniComponent<{ onSelect?: (data?: IconData) => void }>;
}

export const IconPickerServiceIdentifier =
  createIdentifier<IconPickerService>('IconPickerService');
