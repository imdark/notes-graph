import { AllDocsIcon } from '@blocksuite/icons/rc';
import { TagService } from '@notesgraph/core/modules/tag';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { inferOpenMode } from '@notesgraph/core/utils';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { type MouseEvent, useCallback } from 'react';

import { usePageHelper } from '../../../blocksuite/block-suite-page-list/utils';
import { ActionButton } from './action-button';
import docsIllustrationDark from './assets/docs.dark.png';
import docsIllustrationLight from './assets/docs.light.png';
import { EmptyLayout } from './layout';
import type { UniversalEmptyProps } from './types';

export interface EmptyDocsProps extends UniversalEmptyProps {
  type?: 'all' | 'trash';
  /**
   * Used for "New doc", if provided, new doc will be created with this tag.
   */
  tagId?: string;
  allowCreate?: boolean;
}

export const EmptyDocs = ({
  type = 'all',
  tagId,
  allowCreate = true,
  ...props
}: EmptyDocsProps) => {
  const t = useI18n();
  const tagService = useService(TagService);
  const currentWorkspace = useService(WorkspaceService).workspace;
  const pageHelper = usePageHelper(currentWorkspace.docCollection);
  const tag = useLiveData(tagService.tagList.tagByTagId$(tagId));

  const showActionButton = type !== 'trash'; // && !BUILD_CONFIG.isMobileEdition;

  const onCreate = useCallback(
    (e: MouseEvent) => {
      const doc = pageHelper.createPage(undefined, {
        at: inferOpenMode(e),
      });

      if (tag) tag.tag(doc.id);
    },
    [pageHelper, tag]
  );

  return (
    <EmptyLayout
      illustrationLight={docsIllustrationLight}
      illustrationDark={docsIllustrationDark}
      title={t['com.notesgraph.empty.docs.title']()}
      description={
        type === 'trash'
          ? t['com.notesgraph.empty.docs.trash-description']()
          : t['com.notesgraph.empty.docs.all-description']()
      }
      action={
        allowCreate && showActionButton ? (
          <ActionButton onClick={onCreate} prefix={<AllDocsIcon />}>
            {t['com.notesgraph.empty.docs.action.new-doc']()}
          </ActionButton>
        ) : null
      }
      {...props}
    />
  );
};
