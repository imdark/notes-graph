import { notify } from '@notesgraph/component';
import {
  GoBoardOcrService,
  LocalImageService,
  LocalLLMService,
  SpeechService,
} from '@notesgraph/core/modules/ai-local';
import { AppSidebarService } from '@notesgraph/core/modules/app-sidebar';
import { DesktopApiService } from '@notesgraph/core/modules/desktop-api';
import {
  GlobalDialogService,
  WorkspaceDialogService,
} from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { ExplorerIconService } from '@notesgraph/core/modules/explorer-icon/services/explorer-icon';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { I18nService } from '@notesgraph/core/modules/i18n';
import { UrlService } from '@notesgraph/core/modules/url';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService, useServiceOptional, useServices } from '@notesgraph/infra';
import { useStore } from 'jotai';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { usePageHelper } from '../../blocksuite/block-suite-page-list/utils';
import {
  PreconditionStrategy,
  registerLocalAiGoBoardCommands,
  registerLocalAiIconCommands,
  registerLocalAiImageCommands,
  registerLocalAiVoiceCommands,
  registerDoorDashCommands,
  registerNotesGraphCommand,
  registerNotesGraphCreationCommands,
  registerNotesGraphHelpCommands,
  registerNotesGraphLanguageCommands,
  registerNotesGraphLayoutCommands,
  registerNotesGraphNavigationCommands,
  registerNotesGraphSettingsCommands,
  registerNotesGraphUpdatesCommands,
} from '../../commands';
import { EditorSettingService } from '../../modules/editor-setting';
import { CMDKQuickSearchService } from '../../modules/quicksearch/services/cmdk';
import { useNavigateHelper } from './use-navigate-helper';

function registerCMDKCommand(service: CMDKQuickSearchService) {
  return registerNotesGraphCommand({
    id: 'notesgraph:show-quick-search',
    preconditionStrategy: PreconditionStrategy.Never,
    category: 'notesgraph:general',
    keyBinding: {
      binding: '$mod+K',
    },
    label: '',
    icon: '',
    run() {
      service.toggle();
    },
  });
}

export function useRegisterWorkspaceCommands() {
  const store = useStore();
  const t = useI18n();
  const theme = useTheme();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const urlService = useService(UrlService);
  const pageHelper = usePageHelper(currentWorkspace.docCollection);
  const navigationHelper = useNavigateHelper();
  const {
    cMDKQuickSearchService,
    editorSettingService,
    workspaceDialogService,
    globalDialogService,
    appSidebarService,
    i18nService,
  } = useServices({
    CMDKQuickSearchService,
    EditorSettingService,
    WorkspaceDialogService,
    GlobalDialogService,
    AppSidebarService,
    I18nService,
  });

  const i18n = i18nService.i18n;

  const desktopApiService = useServiceOptional(DesktopApiService);
  const workbenchService = useServiceOptional(WorkbenchService);
  const speechService = useService(SpeechService);
  const globalContextService = useService(GlobalContextService);
  const docsService = useService(DocsService);
  const localLLMService = useService(LocalLLMService);
  const localImageService = useService(LocalImageService);
  const goBoardOcrService = useService(GoBoardOcrService);
  const explorerIconService = useService(ExplorerIconService);
  const docModeRegistry = useService(DocModeRegistryService);

  const quitAndInstall = desktopApiService?.handler.updater.quitAndInstall;

  useEffect(() => {
    const unsub = registerCMDKCommand(cMDKQuickSearchService);

    return () => {
      unsub();
    };
  }, [cMDKQuickSearchService]);

  // register NotesGraphUpdatesCommands
  useEffect(() => {
    if (!quitAndInstall) {
      return;
    }

    const unsub = registerNotesGraphUpdatesCommands({
      store,
      t,
      quitAndInstall,
    });

    return () => {
      unsub();
    };
  }, [quitAndInstall, store, t]);

  // register NotesGraphNavigationCommands
  useEffect(() => {
    const unsub = registerNotesGraphNavigationCommands({
      t,
      docCollection: currentWorkspace.docCollection,
      navigationHelper,
      workspaceDialogService,
      workbenchService,
    });

    return () => {
      unsub();
    };
  }, [
    store,
    t,
    currentWorkspace.docCollection,
    navigationHelper,
    globalDialogService,
    workspaceDialogService,
    workbenchService,
  ]);

  // register NotesGraphSettingsCommands
  useEffect(() => {
    const unsub = registerNotesGraphSettingsCommands({
      store,
      t,
      theme,
      editorSettingService,
    });

    return () => {
      unsub();
    };
  }, [editorSettingService, store, t, theme]);

  useEffect(() => {
    const unsub = registerNotesGraphLanguageCommands({
      i18n,
      t,
    });

    return () => {
      unsub();
    };
  }, [i18n, t]);

  // register NotesGraphLayoutCommands
  useEffect(() => {
    const unsub = registerNotesGraphLayoutCommands({ t, appSidebarService });

    return () => {
      unsub();
    };
  }, [appSidebarService, store, t]);

  // register NotesGraphCreationCommands
  useEffect(() => {
    const unsub = registerNotesGraphCreationCommands({
      globalDialogService,
      pageHelper: pageHelper,
      t,
      docModeRegistry,
    });

    return () => {
      unsub();
    };
  }, [store, pageHelper, t, globalDialogService, docModeRegistry]);

  // register DoorDash import command (desktop only)
  useEffect(() => {
    const unsub = registerDoorDashCommands({
      t,
      desktopApiService,
      docsService,
      workbenchService,
    });

    return () => {
      unsub();
    };
  }, [t, desktopApiService, docsService, workbenchService]);

  // register NotesGraphHelpCommands
  useEffect(() => {
    const unsub = registerNotesGraphHelpCommands({
      t,
      urlService,
      workspaceDialogService,
    });

    return () => {
      unsub();
    };
  }, [t, globalDialogService, urlService, workspaceDialogService]);

  // register local-AI voice commands (read aloud / dictate)
  useEffect(() => {
    if (!workbenchService) return;
    const workbench = workbenchService.workbench;
    const unsub = registerLocalAiVoiceCommands({
      speechService,
      docCollection: currentWorkspace.docCollection,
      getActiveDocId: () => globalContextService.globalContext.docId.get(),
      createDoc: () => docsService.createDoc().id,
      openDoc: (id: string) => workbench.openDoc(id),
      notify: (message: string) => notify({ title: message }),
    });
    return () => unsub();
  }, [
    speechService,
    currentWorkspace.docCollection,
    globalContextService,
    docsService,
    workbenchService,
  ]);

  // register local-AI icon generation command
  useEffect(() => {
    const unsub = registerLocalAiIconCommands({
      llm: localLLMService,
      explorerIconService,
      docCollection: currentWorkspace.docCollection,
      getActiveDocId: () => globalContextService.globalContext.docId.get(),
      getDocTitle: (id: string) =>
        docsService.list.docsMap$.value.get(id)?.meta$.value.title?.trim() ||
        'Untitled',
      notify: (message: string) => notify({ title: message }),
    });
    return () => unsub();
  }, [
    localLLMService,
    explorerIconService,
    currentWorkspace.docCollection,
    globalContextService,
    docsService,
  ]);

  // register local-AI image generation command
  useEffect(() => {
    const unsub = registerLocalAiImageCommands({
      imageService: localImageService,
      docCollection: currentWorkspace.docCollection,
      getActiveDocId: () => globalContextService.globalContext.docId.get(),
      notify: (message: string) => notify({ title: message }),
    });
    return () => unsub();
  }, [localImageService, currentWorkspace.docCollection, globalContextService]);

  // register local-AI Go-board reader command
  useEffect(() => {
    const unsub = registerLocalAiGoBoardCommands({
      ocr: goBoardOcrService,
      docCollection: currentWorkspace.docCollection,
      getActiveDocId: () => globalContextService.globalContext.docId.get(),
      notify: (message: string) => notify({ title: message }),
    });
    return () => unsub();
  }, [goBoardOcrService, currentWorkspace.docCollection, globalContextService]);
}
