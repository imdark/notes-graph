import type { DocMode } from '@blocksuite/notesgraph/model';
import { ZipTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
import { toast } from '@notesgraph/component';
import {
  pushGlobalLoadingEventAtom,
  resolveGlobalLoadingEventAtom,
} from '@notesgraph/component/global-loading';
// The blocksuite/ai barrel (~9MB) is imported dynamically inside the effects
// below so this workspace-layout component doesn't pull AI into the route
// chunk's synchronous execution path.
import { useRegisterFindInPageCommands } from '@notesgraph/core/components/hooks/notesgraph/use-register-find-in-page-commands';
import { useRegisterWorkspaceCommands } from '@notesgraph/core/components/hooks/use-register-workspace-commands';
import { OverCapacityNotification } from '@notesgraph/core/components/over-capacity';
import {
  AiBackendService,
  createLocalAIRequestService,
  LocalLLMService,
  LocalVisionService,
} from '@notesgraph/core/modules/ai-local';
import {
  AuthService,
  EventSourceService,
  GraphQLService,
} from '@notesgraph/core/modules/cloud';
import {
  GlobalDialogService,
  WorkspaceDialogService,
} from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { EditorSettingService } from '@notesgraph/core/modules/editor-setting';
import { useRegisterNavigationCommands } from '@notesgraph/core/modules/navigation/view/use-register-navigation-commands';
import {
  usePluginHostEvents,
  usePluginWorkspaceBridge,
  useRegisterPluginCommands,
} from '@notesgraph/core/modules/plugin';
import { QuickSearchContainer } from '@notesgraph/core/modules/quicksearch';
import { NbstoreService } from '@notesgraph/core/modules/storage';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import {
  getNotesGraphWorkspaceSchema,
  WorkspaceService,
} from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import {
  effect,
  fromPromise,
  onStart,
  throwIfAborted,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import track from '@notesgraph/track';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { catchError, EMPTY, finalize, switchMap, tap, timeout } from 'rxjs';

/**
 * @deprecated just for legacy code, will be removed in the future
 */
export const WorkspaceSideEffects = () => {
  const t = useI18n();
  const pushGlobalLoadingEvent = useSetAtom(pushGlobalLoadingEventAtom);
  const resolveGlobalLoadingEvent = useSetAtom(resolveGlobalLoadingEventAtom);
  const { workspaceService, docsService } = useServices({
    WorkspaceService,
    DocsService,
    EditorSettingService,
  });
  const currentWorkspace = workspaceService.workspace;
  const docsList = docsService.list;

  const workbench = useService(WorkbenchService).workbench;
  useEffect(() => {
    const insertTemplate = effect(
      switchMap(({ template, mode }: { template: string; mode: string }) => {
        return fromPromise(async abort => {
          const templateZip = await fetch(template, { signal: abort });
          const templateBlob = await templateZip.blob();
          throwIfAborted(abort);
          const [doc] = await ZipTransformer.importDocs(
            currentWorkspace.docCollection,
            getNotesGraphWorkspaceSchema(),
            templateBlob
          );
          if (doc) {
            doc.resetHistory();
          }

          return { doc, mode };
        }).pipe(
          timeout(10000 /* 10s */),
          tap(({ mode, doc }) => {
            if (doc) {
              docsList.setPrimaryMode(doc.id, mode as DocMode);
              workbench.openDoc(doc.id);
            }
          }),
          onStart(() => {
            pushGlobalLoadingEvent({
              key: 'insert-template',
            });
          }),
          catchError(err => {
            console.error(err);
            toast(t['com.notesgraph.ai.template-insert.failed']());
            return EMPTY;
          }),
          finalize(() => {
            resolveGlobalLoadingEvent('insert-template');
          })
        );
      })
    );

    let cancelled = false;
    let disposable: { unsubscribe: () => void } | undefined;
    void import('@notesgraph/core/blocksuite/ai').then(({ AIAppEvents }) => {
      if (cancelled) return;
      disposable = AIAppEvents.requestInsertTemplate.subscribe(
        ({ template, mode }) => {
          insertTemplate({ template, mode });
        }
      );
    });

    return () => {
      cancelled = true;
      disposable?.unsubscribe();
      insertTemplate.unsubscribe();
    };
  }, [
    currentWorkspace.docCollection,
    docsList,
    pushGlobalLoadingEvent,
    resolveGlobalLoadingEvent,
    t,
    workbench,
  ]);

  const workspaceDialogService = useService(WorkspaceDialogService);
  const globalDialogService = useService(GlobalDialogService);

  useEffect(() => {
    let cancelled = false;
    let disposable: { unsubscribe: () => void } | undefined;
    void import('@notesgraph/core/blocksuite/ai').then(({ AIAppEvents }) => {
      if (cancelled) return;
      disposable = AIAppEvents.requestUpgradePlan.subscribe(() => {
        workspaceDialogService.open('setting', {
          activeTab: 'billing',
        });
        track.$.paywall.aiAction.viewPlans();
      });
    });
    return () => {
      cancelled = true;
      disposable?.unsubscribe();
    };
  }, [workspaceDialogService]);

  const graphqlService = useService(GraphQLService);
  const eventSourceService = useService(EventSourceService);
  const authService = useService(AuthService);
  const nbstoreService = useService(NbstoreService);
  const aiBackendService = useService(AiBackendService);
  const aiBackend = useLiveData(aiBackendService.backend$);
  const localLLMService = useService(LocalLLMService);
  const localVisionService = useService(LocalVisionService);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import('@notesgraph/core/blocksuite/ai').then(
      ({ createAIRequestService, setupAIProvider }) => {
        if (cancelled) return;
        // Local backend runs on-device (no cloud calls); cloud uses the copilot.
        const requestService =
          aiBackend === 'local'
            ? createLocalAIRequestService(
                localLLMService,
                undefined,
                localVisionService
              )
            : createAIRequestService(
                graphqlService.gql,
                eventSourceService.eventSource,
                nbstoreService.realtime
              );
        dispose = setupAIProvider(
          requestService,
          globalDialogService,
          authService
        );
      }
    );
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [
    aiBackend,
    localLLMService,
    localVisionService,
    eventSourceService,
    nbstoreService,
    workspaceDialogService,
    graphqlService,
    globalDialogService,
    authService,
  ]);

  useRegisterWorkspaceCommands();
  useRegisterNavigationCommands();
  useRegisterFindInPageCommands();
  useRegisterPluginCommands();
  usePluginWorkspaceBridge();
  usePluginHostEvents();

  return (
    <>
      <QuickSearchContainer />
      <OverCapacityNotification />
    </>
  );
};
