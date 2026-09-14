import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import { GlobalContextService } from '../../global-context';
import { WorkbenchService } from '../../workbench';
import { PluginContextFactory } from '../services/context-factory';

/**
 * Emits host lifecycle/navigation events into the plugin event bus (the
 * `hooks` capability). Render once inside a workspace scope. (doc.save and
 * selection.change require editor-level wiring — future.)
 */
export function usePluginHostEvents() {
  const factory = useService(PluginContextFactory);
  const globalContextService = useService(GlobalContextService);
  const workbenchService = useService(WorkbenchService);

  useEffect(() => {
    factory.emit('app.open');

    let prevDocId: string | null | undefined = null;
    const docSub = globalContextService.globalContext.docId.$.subscribe(
      docId => {
        if (docId === prevDocId) return;
        if (prevDocId) factory.emit('doc.close', { docId: prevDocId });
        if (docId) factory.emit('doc.open', { docId });
        prevDocId = docId;
      }
    );

    const navSub = workbenchService.workbench.location$.subscribe(location => {
      factory.emit('navigate', { pathname: location.pathname });
    });

    return () => {
      docSub.unsubscribe();
      navSub.unsubscribe();
    };
  }, [factory, globalContextService, workbenchService]);
}
