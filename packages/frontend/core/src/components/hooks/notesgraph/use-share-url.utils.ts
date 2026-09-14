import type { DocMode } from '@blocksuite/notesgraph/model';

export const getDefaultShareMode = (
  currentMode?: DocMode
): DocMode | undefined => {
  return currentMode === 'edgeless' ? 'edgeless' : undefined;
};
