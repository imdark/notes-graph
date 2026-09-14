import type { NotesGraphReference } from '@blocksuite/notesgraph/inlines/reference';
import { ReferenceNodeConfigExtension } from '@blocksuite/notesgraph/inlines/reference';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { ReactToLit } from '@notesgraph/component';

export type ReferenceReactRenderer = (
  reference: NotesGraphReference
) => React.ReactElement;

export function patchReferenceRenderer(
  reactToLit: ReactToLit,
  reactRenderer: ReferenceReactRenderer
): ExtensionType {
  const customContent = (reference: NotesGraphReference) => {
    const node = reactRenderer(reference);
    return reactToLit(node, true);
  };

  return ReferenceNodeConfigExtension({
    customContent,
    hidePopup: BUILD_CONFIG.isMobileEdition,
  });
}
