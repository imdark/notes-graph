import { ShareiOsIcon } from '@blocksuite/icons/rc';
import { IconButton, MobileMenu } from '@notesgraph/component';
import { useEnableCloud } from '@notesgraph/core/components/hooks/notesgraph/use-enable-cloud';
import { DocService } from '@notesgraph/core/modules/doc';
import { ShareMenuContent } from '@notesgraph/core/modules/share-menu';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useServices } from '@notesgraph/infra';

import * as styles from './page-header-share-button.css';

export const PageHeaderShareButton = () => {
  const { workspaceService, docService } = useServices({
    WorkspaceService,
    DocService,
  });
  const workspace = workspaceService.workspace;
  const doc = docService.doc.blockSuiteDoc;
  const confirmEnableCloud = useEnableCloud();

  if (workspace.meta.flavour === 'local') {
    return null;
  }

  return (
    <MobileMenu
      items={
        <div className={styles.content}>
          <ShareMenuContent
            workspaceMetadata={workspace.meta}
            currentPage={doc}
            onEnableNotesGraphCloud={() =>
              confirmEnableCloud(workspace, {
                openPageId: doc.id,
              })
            }
          />
        </div>
      }
    >
      <IconButton size={24} style={{ padding: 10 }} icon={<ShareiOsIcon />} />
    </MobileMenu>
  );
};
