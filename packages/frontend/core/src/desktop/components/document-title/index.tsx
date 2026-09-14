import { NotificationCountService } from '@notesgraph/core/modules/notification';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

export const DocumentTitle = () => {
  const notificationCountService = useService(NotificationCountService);
  const notificationCount = useLiveData(notificationCountService.count$);
  const workbenchService = useService(WorkbenchService);
  const workbenchView = useLiveData(workbenchService.workbench.activeView$);
  const viewTitle = useLiveData(workbenchView.title$);

  useEffect(() => {
    const prefix = notificationCount > 0 ? `(${notificationCount}) ` : '';
    document.title =
      prefix + (viewTitle ? `${viewTitle} · NotesGraph` : 'NotesGraph');

    return () => {
      document.title = 'NotesGraph';
    };
  }, [notificationCount, viewTitle]);

  return null;
};
