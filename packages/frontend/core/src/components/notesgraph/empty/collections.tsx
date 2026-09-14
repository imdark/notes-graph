import { ViewLayersIcon } from '@blocksuite/icons/rc';
import { usePromptModal } from '@notesgraph/component';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { CollectionService } from '@notesgraph/core/modules/collection';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import { ActionButton } from './action-button';
import collectionListDark from './assets/collection-list.dark.png';
import collectionListLight from './assets/collection-list.light.png';
import { EmptyLayout } from './layout';
import type { UniversalEmptyProps } from './types';

export const EmptyCollections = (props: UniversalEmptyProps) => {
  const t = useI18n();
  const collectionService = useService(CollectionService);
  const currentWorkspace = useService(WorkspaceService).workspace;

  const navigateHelper = useNavigateHelper();
  const { openPromptModal } = usePromptModal();

  const showAction = true;

  const handleCreateCollection = useCallback(() => {
    openPromptModal({
      title: t['com.notesgraph.editCollection.saveCollection'](),
      label: t['com.notesgraph.editCollectionName.name'](),
      inputOptions: {
        placeholder: t['com.notesgraph.editCollectionName.name.placeholder'](),
      },
      children: t['com.notesgraph.editCollectionName.createTips'](),
      confirmText: t['com.notesgraph.editCollection.save'](),
      cancelText: t['com.notesgraph.editCollection.button.cancel'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm(name) {
        const id = collectionService.createCollection({ name });
        navigateHelper.jumpToCollection(currentWorkspace.id, id);
      },
    });
  }, [
    collectionService,
    currentWorkspace.id,
    navigateHelper,
    openPromptModal,
    t,
  ]);

  return (
    <EmptyLayout
      illustrationLight={collectionListLight}
      illustrationDark={collectionListDark}
      title={t['com.notesgraph.empty.collections.title']()}
      description={t['com.notesgraph.empty.collections.description']()}
      action={
        showAction ? (
          <ActionButton
            prefix={<ViewLayersIcon />}
            onClick={handleCreateCollection}
          >
            {t['com.notesgraph.empty.collections.action.new-collection']()}
          </ActionButton>
        ) : null
      }
      {...props}
    />
  );
};
