import { AddCollectionIcon } from '@blocksuite/icons/rc';
import { usePromptModal } from '@notesgraph/component';
import { NavigationPanelTreeRoot } from '@notesgraph/core/desktop/components/navigation-panel';
import { CollectionService } from '@notesgraph/core/modules/collection';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useMemo } from 'react';

import { AddItemPlaceholder } from '../../layouts/add-item-placeholder';
import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelCollectionNode } from '../../nodes/collection';
import * as styles from './index.css';

export const NavigationPanelCollections = () => {
  const t = useI18n();
  const { collectionService, workbenchService, navigationPanelService } =
    useServices({
      CollectionService,
      WorkbenchService,
      NavigationPanelService,
    });
  const path = useMemo(() => ['collections'], []);
  const collectionMetas = useLiveData(collectionService.collectionMetas$);
  const { openPromptModal } = usePromptModal();

  const handleCreateCollection = useCallback(() => {
    openPromptModal({
      title: t['com.notesgraph.editCollection.saveCollection'](),
      label: t['com.notesgraph.editCollectionName.name'](),
      inputOptions: {
        placeholder: t['com.notesgraph.editCollectionName.name.placeholder'](),
      },
      children: (
        <div className={styles.createTips}>
          {t['com.notesgraph.editCollectionName.createTips']()}
        </div>
      ),
      confirmText: t['com.notesgraph.editCollection.save'](),
      cancelText: t['com.notesgraph.editCollection.button.cancel'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm(name) {
        const id = collectionService.createCollection({ name });
        track.$.navigationPanel.organize.createOrganizeItem({
          type: 'collection',
        });
        workbenchService.workbench.openCollection(id);
        navigationPanelService.setCollapsed(path, false);
      },
    });
  }, [
    collectionService,
    navigationPanelService,
    path,
    openPromptModal,
    t,
    workbenchService.workbench,
  ]);

  return (
    <CollapsibleSection
      path={path}
      testId="navigation-panel-collections"
      title={t['com.notesgraph.rootAppSidebar.collections']()}
    >
      <NavigationPanelTreeRoot>
        {collectionMetas.map(collection => (
          <NavigationPanelCollectionNode
            key={collection.id}
            collectionId={collection.id}
            parentPath={path}
          />
        ))}
        <AddItemPlaceholder
          icon={<AddCollectionIcon />}
          data-testid="navigation-panel-bar-add-collection-button"
          label={t['com.notesgraph.rootAppSidebar.collection.new']()}
          onClick={() => handleCreateCollection()}
        />
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
