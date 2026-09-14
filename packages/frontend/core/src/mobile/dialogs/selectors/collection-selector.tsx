import { ViewLayersIcon } from '@blocksuite/icons/rc';
import { Modal } from '@notesgraph/component';
import { CollectionService } from '@notesgraph/core/modules/collection';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useMemo } from 'react';

import { GenericSelector } from './generic-selector';

export const CollectionSelectorDialog = ({
  close,
  init,
  onBeforeConfirm,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['collection-selector']>) => {
  const t = useI18n();
  const collectionService = useService(CollectionService);
  const collections = useLiveData(collectionService.collectionMetas$);

  const list = useMemo(() => {
    return collections.map(collection => ({
      id: collection.id,
      icon: <ViewLayersIcon />,
      label: collection.name,
    }));
  }, [collections]);

  return (
    <Modal
      open
      onOpenChange={() => close()}
      withoutCloseButton
      fullScreen
      contentOptions={{
        style: {
          background: cssVarV2('layer/background/secondary'),
          padding: 0,
        },
      }}
    >
      <GenericSelector
        onBack={close}
        onConfirm={close}
        onBeforeConfirm={onBeforeConfirm}
        initial={init}
        data={list}
        typeName={t[`com.notesgraph.m.selector.type-collection`]()}
      />
    </Modal>
  );
};
