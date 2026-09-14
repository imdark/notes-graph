import { AddCollectionIcon } from '@blocksuite/icons/rc';
import { IconButton, usePromptModal } from '@notesgraph/component';
import { CollectionService } from '@notesgraph/core/modules/collection';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useMemo } from 'react';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelCollectionNode } from '../../nodes/collection';
import { NavigationPanelTreeRoot } from '../../tree';
import { RootEmpty } from './empty';
import * as styles from './index.css';

export const NavigationPanelCollections = () => {
  const t = useI18n();
  const { collectionService, workbenchService, navigationPanelService } =
    useServices({
      CollectionService,
      WorkbenchService,
      NavigationPanelService,
    });
  const collections = useLiveData(collectionService.collections$);
  const { openPromptModal } = usePromptModal();
  const path = useMemo(() => ['collections'], []);
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
    openPromptModal,
    path,
    t,
    workbenchService.workbench,
  ]);

  return (
    <CollapsibleSection
      path={path}
      testId="navigation-panel-collections"
      title={t['com.notesgraph.rootAppSidebar.collections']()}
      actions={
        <IconButton
          data-testid="navigation-panel-bar-add-collection-button"
          onClick={handleCreateCollection}
          size="16"
          tooltip={t[
            'com.notesgraph.rootAppSidebar.explorer.collection-section-add-tooltip'
          ]()}
        >
          <AddCollectionIcon />
        </IconButton>
      }
    >
      <NavigationPanelTreeRoot
        placeholder={<RootEmpty onClickCreate={handleCreateCollection} />}
      >
        {Array.from(collections.values()).map(collection => (
          <NavigationPanelCollectionNode
            key={collection.id}
            collectionId={collection.id}
            reorderable={false}
            location={{
              at: 'navigation-panel:collection:list',
            }}
            parentPath={path}
          />
        ))}
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
