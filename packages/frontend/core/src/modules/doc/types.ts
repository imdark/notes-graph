import type { DocMode } from '@blocksuite/notesgraph/model';
import type { DocProps } from '@notesgraph/core/blocksuite/initialization';

export interface DocCreateOptions {
  id?: string;
  title?: string;
  primaryMode?: DocMode;
  skipInit?: boolean;
  docProps?: DocProps;
  isTemplate?: boolean;
}
