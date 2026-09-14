// oxlint-disable-next-line no-restricted-imports
import 'katex/dist/katex.min.css';

import type { DocTitle } from '@blocksuite/notesgraph/fragments/doc-title';
import type { DocMode } from '@blocksuite/notesgraph/model';
import type { Store } from '@blocksuite/notesgraph/store';
import { useConfirmModal, useLitPortalFactory } from '@notesgraph/component';
import {
  LitDocEditor,
  LitDocTitle,
  type PageEditor,
} from '@notesgraph/core/blocksuite/editors';
import {
  ensureAIViewExtension,
  getViewManager,
} from '@notesgraph/core/blocksuite/manager/view';
import { useEnableAI } from '@notesgraph/core/components/hooks/notesgraph/use-enable-ai';
import { ServerService } from '@notesgraph/core/modules/cloud';
import type { DocCustomPropertyInfo } from '@notesgraph/core/modules/db';
import type {
  DatabaseRow,
  DatabaseValueCell,
} from '@notesgraph/core/modules/doc-info/types';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorSettingService } from '@notesgraph/core/modules/editor-setting';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { JournalService } from '@notesgraph/core/modules/journal';
import { useInsidePeekView } from '@notesgraph/core/modules/peek-view';
import { PluginContributionRegistry } from '@notesgraph/core/modules/plugin';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { ServerFeature } from '@notesgraph/graphql';
import {
  useFramework,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import track from '@notesgraph/track';
import type React from 'react';
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { DocGlobalComments } from '../../components/comment/global';
import { SharedPageComments } from './shared-page-comments';
import {
  type DefaultOpenProperty,
  WorkspacePropertiesTable,
} from '../../components/properties';
import { BiDirectionalLinkPanel } from './bi-directional-link-panel';
import { DocBanner } from './doc-banner';
import { DocIconPicker } from './doc-icon-picker';
import { BlocksuiteEditorJournalDocTitle } from './journal-doc-title';
import { OutlineZoomBreadcrumb, useOutlineZoom } from './outline-zoom';
import { StarterBar } from './starter-bar';
import * as styles from './styles.css';
import { useDocProjectLinkGuard } from './use-doc-project-link-guard';

interface BlocksuiteEditorProps {
  page: Store;
  readonly?: boolean;
  shared?: boolean;
  /** shared page whose public link grants read + comment */
  sharedCommentable?: boolean;
  defaultOpenProperty?: DefaultOpenProperty;
}

export const usePatchSpecs = (mode: DocMode, shared?: boolean) => {
  const [reactToLit, portals] = useLitPortalFactory();
  const {
    workspaceService,
    featureFlagService,
    pluginContributionRegistry,
    docModeRegistryService,
  } = useServices({
    WorkspaceService,
    FeatureFlagService,
    PluginContributionRegistry,
    DocModeRegistryService,
  });
  const isCloud = workspaceService.workspace.flavour !== 'local';
  const framework = useFramework();

  const confirmModal = useConfirmModal();

  const enableAI = useEnableAI();

  const isInPeekView = useInsidePeekView();

  const enableTurboRenderer = useLiveData(
    featureFlagService.flags.enable_turbo_renderer.$
  );

  const enablePDFEmbedPreview = useLiveData(
    featureFlagService.flags.enable_pdf_embed_preview.$
  );

  const serverService = useService(ServerService);
  const serverConfig = useLiveData(serverService.server.config$);

  // View-extension providers contributed by active plugins (e.g. the edgeless
  // plugin). Synced into the shared ViewExtensionManager before resolving specs.
  const editorExtensions = useLiveData(
    pluginContributionRegistry.editorExtensions$
  );
  const modeViewExtensions = useLiveData(
    docModeRegistryService.viewExtensions$
  );
  // The AI view extension (~9MB) is loaded lazily so it stays out of the
  // initial bundle. ensureAIViewExtension registers it once, globally, on the
  // manager; aiReady flips afterwards so the spec memo below re-resolves and
  // `.ai(...)` configures the now-present extension.
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    if (!enableAI) return;
    let cancelled = false;
    void ensureAIViewExtension().then(() => {
      if (!cancelled) setAiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enableAI]);

  const pluginViewProviders = useMemo(
    () => [
      ...editorExtensions.flatMap(entry => entry.providers),
      ...modeViewExtensions,
    ],
    [editorExtensions, modeViewExtensions]
  );

  // Comments: on cloud they need the server's Comment feature; on local
  // workspaces they're backed by the local DB (see DocCommentStore). Shared
  // (public) pages never get the comment affordance.
  const enableComment =
    !shared &&
    (isCloud ? serverConfig.features.includes(ServerFeature.Comment) : true);

  const patchedSpecs = useMemo(() => {
    const viewProvider = getViewManager();
    viewProvider.syncPluginProviders(pluginViewProviders);
    const manager = viewProvider.config
      .init()
      .foundation(framework)
      .ai(enableAI && aiReady, framework)
      .theme(framework)
      .editorConfig(framework)
      .editorView({
        framework,
        reactToLit,
        confirmModal,
      })
      .cloud(framework, isCloud)
      .turboRenderer(enableTurboRenderer)
      .pdf(enablePDFEmbedPreview, reactToLit)
      .edgelessBlockHeader({
        framework,
        isInPeekView,
        reactToLit,
      })
      .database(framework)
      .linkedDoc(framework)
      .paragraph(enableAI)
      .mobile(framework)
      .electron(framework)
      .linkPreview(framework)
      .codeBlockPreview(framework)
      .iconPicker(framework)
      .schedule(framework)
      .agents(framework)
      .comment(enableComment, framework).value;

    if (BUILD_CONFIG.isMobileEdition) {
      if (mode === 'page') {
        return manager.get('mobile-page');
      } else {
        return manager.get('mobile-edgeless');
      }
    } else {
      return manager.get(mode);
    }
  }, [
    aiReady,
    confirmModal,
    enableAI,
    enablePDFEmbedPreview,
    enableTurboRenderer,
    enableComment,
    framework,
    isInPeekView,
    isCloud,
    mode,
    pluginViewProviders,
    reactToLit,
  ]);

  return [
    patchedSpecs,
    useMemo(
      () => (
        <>
          {portals.map(p => (
            <Fragment key={p.id}>{p.portal}</Fragment>
          ))}
        </>
      ),
      [portals]
    ),
  ] as const;
};

export const BlocksuiteDocEditor = forwardRef<
  PageEditor,
  BlocksuiteEditorProps & {
    onClickBlank?: () => void;
    titleRef?: React.Ref<DocTitle>;
  }
>(function BlocksuiteDocEditor(
  {
    page,
    shared,
    sharedCommentable,
    onClickBlank,
    titleRef: externalTitleRef,
    defaultOpenProperty,
    readonly,
  },
  ref
) {
  const titleRef = useRef<DocTitle | null>(null);
  const docRef = useRef<PageEditor | null>(null);
  const [editorEl, setEditorEl] = useState<PageEditor | null>(null);
  const journalService = useService(JournalService);
  const isJournal = !!useLiveData(journalService.journalDate$(page.id));

  const editorSettingService = useService(EditorSettingService);

  const onDocRef = useCallback(
    (el: PageEditor) => {
      docRef.current = el;
      // LitDocEditor bridges a lit element and assigns this ref during its own
      // render; defer the state update so we don't setState mid-render (which
      // React warns about). The ref handoff below stays synchronous.
      queueMicrotask(() => setEditorEl(el));
      if (ref) {
        if (typeof ref === 'function') {
          ref(el);
        } else {
          ref.current = el;
        }
      }
    },
    [ref]
  );

  const onTitleRef = useCallback(
    (el: DocTitle) => {
      titleRef.current = el;
      if (externalTitleRef) {
        if (typeof externalTitleRef === 'function') {
          externalTitleRef(el);
        } else {
          externalTitleRef.current = el;
        }
      }
    },
    [externalTitleRef]
  );

  const [specs, portals] = usePatchSpecs('page', shared);

  const workspaceService = useService(WorkspaceService);
  useDocProjectLinkGuard(
    page.id,
    !shared && !readonly && workspaceService.workspace.flavour !== 'local'
  );

  const outlineZoom = useOutlineZoom(editorEl, page);

  const displayBiDirectionalLink = useLiveData(
    editorSettingService.editorSetting.settings$.selector(
      s => s.displayBiDirectionalLink
    )
  );

  const displayDocInfo = useLiveData(
    editorSettingService.editorSetting.settings$.selector(s => s.displayDocInfo)
  );

  const onPropertyChange = useCallback((property: DocCustomPropertyInfo) => {
    track.doc.inlineDocInfo.property.editProperty({
      type: property.type,
    });
  }, []);

  const onPropertyAdded = useCallback((property: DocCustomPropertyInfo) => {
    track.doc.inlineDocInfo.property.addProperty({
      type: property.type,
      control: 'at menu',
    });
  }, []);

  const onDatabasePropertyChange = useCallback(
    (_row: DatabaseRow, cell: DatabaseValueCell) => {
      track.doc.inlineDocInfo.databaseProperty.editProperty({
        type: cell.property.type$.value,
      });
    },
    []
  );

  const onPropertyInfoChange = useCallback(
    (property: DocCustomPropertyInfo, field: string) => {
      track.doc.inlineDocInfo.property.editPropertyMeta({
        type: property.type,
        field,
      });
    },
    []
  );

  return (
    <>
      <div className={styles.notesgraphDocViewport}>
        {outlineZoom.focusedId ? (
          <OutlineZoomBreadcrumb
            focusTitle={outlineZoom.focusTitle}
            onExit={outlineZoom.exit}
          />
        ) : null}
        {!BUILD_CONFIG.isMobileEdition ? (
          <>
            <DocBanner docId={page.id} readonly={readonly || shared} />
            <DocIconPicker docId={page.id} readonly={readonly || shared} />
          </>
        ) : null}
        {!isJournal ? (
          <LitDocTitle doc={page} ref={onTitleRef} />
        ) : (
          <BlocksuiteEditorJournalDocTitle page={page} />
        )}
        {!shared && displayDocInfo ? (
          <div className={styles.docPropertiesTableContainer}>
            <WorkspacePropertiesTable
              className={styles.docPropertiesTable}
              onDatabasePropertyChange={onDatabasePropertyChange}
              onPropertyChange={onPropertyChange}
              onPropertyAdded={onPropertyAdded}
              onPropertyInfoChange={onPropertyInfoChange}
              defaultOpenProperty={defaultOpenProperty}
            />
          </div>
        ) : null}
        <LitDocEditor
          className={styles.docContainer}
          ref={onDocRef}
          doc={page}
          specs={specs}
        />
        <div
          className={styles.docEditorGap}
          data-testid="page-editor-blank"
          onClick={onClickBlank}
        ></div>
        {!readonly && !BUILD_CONFIG.isMobileEdition && (
          <StarterBar doc={page} />
        )}
        {!shared && displayBiDirectionalLink ? (
          <BiDirectionalLinkPanel />
        ) : null}
        {!shared && !readonly ? (
          <DocGlobalComments />
        ) : shared && sharedCommentable ? (
          <SharedPageComments />
        ) : null}
      </div>
      {portals}
    </>
  );
});
