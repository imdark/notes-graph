import { useThemeColorV2 } from '@notesgraph/component';
import { CaptureView } from '@notesgraph/core/components/capture';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';

import { PageHeader } from '../../components';
import { Page } from '../../components/page';

/**
 * Where the "NotesGraph Capture" launcher icon lands: listening straight
 * away, since the launcher is for getting an idea down by voice.
 */
export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  const workbench = useService(WorkbenchService).workbench;

  return (
    <Page
      header={
        // Opened from the launcher there is no page to go back to.
        <PageHeader back backAction={() => workbench.open('/home')}>
          Capture
        </PageHeader>
      }
    >
      <CaptureView autoListen />
    </Page>
  );
};
