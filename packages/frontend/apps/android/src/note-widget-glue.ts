import { ServersService } from '@notesgraph/core/modules/cloud';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { WorkspacesService } from '@notesgraph/core/modules/workspace';
import { type FrameworkProvider, LiveData } from '@notesgraph/infra';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { NoteWidget } from './plugins/note-widget';

/**
 * Keep the home-screen note widgets pointed at the cloud workspace the app
 * has open. A widget reads its note from the server with the app closed, so
 * native needs the server URL and workspace id; the token it reads itself.
 */
export function setupNoteWidget(framework: FrameworkProvider) {
  const globalContext = framework.get(GlobalContextService).globalContext;
  const workspacesService = framework.get(WorkspacesService);
  const serversService = framework.get(ServersService);

  const target$ = LiveData.computed(get => {
    const workspaceId = get(globalContext.workspaceId.$);
    const meta = get(workspacesService.list.workspaces$).find(
      workspace => workspace.id === workspaceId
    );
    // For a cloud workspace the metadata flavour is the server id.
    const server =
      meta && meta.flavour !== 'local'
        ? get(serversService.servers$).find(s => s.id === meta.flavour)
        : undefined;
    return server && workspaceId
      ? { server: server.baseUrl, workspaceId }
      : { server: null, workspaceId: null };
  });

  const subscription = target$
    .pipe(
      debounceTime(1000),
      distinctUntilChanged(
        (a, b) => a.server === b.server && a.workspaceId === b.workspaceId
      )
    )
    .subscribe(target => {
      NoteWidget.setWorkspace(target).catch(error => {
        console.error('[note-widget] failed to set workspace', error);
      });
    });

  return () => subscription.unsubscribe();
}
