import { LinkedPageIcon, PlusIcon } from '@blocksuite/icons/rc';
import {
  MenuSeparator,
  MenuSub,
  MenuItem,
} from '@notesgraph/component/ui/menu';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { preventDefault } from '@notesgraph/core/utils';
import { useLiveData, useService } from '@notesgraph/infra';

import { ParentPickerContent } from './parent-picker';
import {
  useCurrentParents,
  useSetParent,
  useSuggestedParents,
} from './use-suggest-parent';

/**
 * "Set parent…" section for the mobile doc more-menu. Available for every doc
 * (with or without existing parents): top suggestions as one-tap items plus a
 * search-any-note picker. Adds parents (the graph allows several); swapping is
 * done by removing a parent from the in-editor parent bar.
 */
export const SetParentMenuSection = ({ docId }: { docId?: string }) => {
  const featureFlagService = useService(FeatureFlagService);
  const enabled = useLiveData(
    featureFlagService.flags.enable_suggest_parent.$
  );
  const parents = useCurrentParents(docId);
  const suggestions = useSuggestedParents(docId, 3);
  const setParent = useSetParent();

  if (!enabled || !docId) {
    return null;
  }

  const excludeIds = parents.map(p => p.docId);

  return (
    <>
      <MenuSeparator />
      {suggestions.map(s => (
        <MenuItem
          key={s.docId}
          prefixIcon={<PlusIcon />}
          onSelect={() => setParent(s.docId, docId, s.title)}
        >
          {s.title || 'Untitled'}
        </MenuItem>
      ))}
      <MenuSub
        triggerOptions={{
          prefixIcon: <LinkedPageIcon />,
          onClick: preventDefault,
        }}
        title="Set parent"
        items={
          <ParentPickerContent
            docId={docId}
            excludeIds={excludeIds}
            onSelect={(parentId, title) => setParent(parentId, docId, title)}
          />
        }
      >
        <span>Set parent…</span>
      </MenuSub>
    </>
  );
};
