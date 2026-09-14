import { DatabaseViewExtension } from '@blocksuite/notesgraph/blocks/database/view';
import { ParagraphViewExtension } from '@blocksuite/notesgraph/blocks/paragraph/view';
import type {
  PeekOptions,
  PeekViewService as BSPeekViewService,
} from '@blocksuite/notesgraph/components/peek';
import { ViewExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getInternalViewExtensions } from '@blocksuite/notesgraph/extensions/view';
import { FoundationViewExtension } from '@blocksuite/notesgraph/foundation/view';
import { InlineCommentViewExtension } from '@blocksuite/notesgraph/inlines/comment';
import { NotesGraphCanvasTextFonts } from '@blocksuite/notesgraph/shared/services';
import { LinkedDocViewExtension } from '@blocksuite/notesgraph/widgets/linked-doc/view';
import type { ReactToLit } from '@notesgraph/component';
// AIViewExtension pulls the ~9MB blocksuite/ai bundle. It is NOT imported here
// (that would drag AI into the initial bundle via getViewManager, which runs at
// bootstrap for doc CRUD). Instead the editor host loads it lazily and registers
// it as a provider once AI is enabled — see block-suite-editor/lit-adaper.tsx.
import { CloudViewExtension } from '@notesgraph/core/blocksuite/view-extensions/cloud';
import { CodeBlockPreviewViewExtension } from '@notesgraph/core/blocksuite/view-extensions/code-block-preview';
import { CommentViewExtension } from '@notesgraph/core/blocksuite/view-extensions/comment';
import { NotesGraphDatabaseViewExtension } from '@notesgraph/core/blocksuite/view-extensions/database';
import {
  EdgelessBlockHeaderConfigViewExtension,
  type EdgelessBlockHeaderViewOptions,
} from '@notesgraph/core/blocksuite/view-extensions/edgeless-block-header';
import { NotesGraphEditorConfigViewExtension } from '@notesgraph/core/blocksuite/view-extensions/editor-config';
import { createDatabaseOptionsConfig } from '@notesgraph/core/blocksuite/view-extensions/editor-config/database';
import { createLinkedWidgetConfig } from '@notesgraph/core/blocksuite/view-extensions/editor-config/linked';
import {
  NotesGraphEditorViewExtension,
  type NotesGraphEditorViewOptions,
} from '@notesgraph/core/blocksuite/view-extensions/editor-view/editor-view';
import { ElectronViewExtension } from '@notesgraph/core/blocksuite/view-extensions/electron';
import { NotesGraphIconPickerExtension } from '@notesgraph/core/blocksuite/view-extensions/icon-picker';
import { NotesGraphLinkPreviewExtension } from '@notesgraph/core/blocksuite/view-extensions/link-preview-service';
import { MobileViewExtension } from '@notesgraph/core/blocksuite/view-extensions/mobile';
import { OutlineZoomViewExtension } from '@notesgraph/core/blocksuite/view-extensions/outline-zoom';
import { PdfViewExtension } from '@notesgraph/core/blocksuite/view-extensions/pdf';
import { AgentsViewExtension } from '@notesgraph/core/blocksuite/view-extensions/agents';
import { ScheduleViewExtension } from '@notesgraph/core/blocksuite/view-extensions/schedule';
import { NotesGraphThemeViewExtension } from '@notesgraph/core/blocksuite/view-extensions/theme';
import { TurboRendererViewExtension } from '@notesgraph/core/blocksuite/view-extensions/turbo-renderer';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { DebugLogger } from '@notesgraph/debug';
import type { FrameworkProvider } from '@notesgraph/infra';
import { tracker } from '@notesgraph/track';
import type { TemplateResult } from 'lit';

type Configure = {
  init: () => Configure;

  foundation: (framework?: FrameworkProvider) => Configure;
  editorView: (options?: NotesGraphEditorViewOptions) => Configure;
  theme: (framework?: FrameworkProvider) => Configure;
  editorConfig: (framework?: FrameworkProvider) => Configure;
  edgelessBlockHeader: (options?: EdgelessBlockHeaderViewOptions) => Configure;
  database: (framework?: FrameworkProvider) => Configure;
  linkedDoc: (framework?: FrameworkProvider) => Configure;
  paragraph: (enableAI?: boolean) => Configure;
  cloud: (framework?: FrameworkProvider, enableCloud?: boolean) => Configure;
  turboRenderer: (enableTurboRenderer?: boolean) => Configure;
  pdf: (enablePDFEmbedPreview?: boolean, reactToLit?: ReactToLit) => Configure;
  mobile: (framework?: FrameworkProvider) => Configure;
  ai: (enable?: boolean, framework?: FrameworkProvider) => Configure;
  electron: (framework?: FrameworkProvider) => Configure;
  linkPreview: (framework?: FrameworkProvider) => Configure;
  codeBlockPreview: (framework?: FrameworkProvider) => Configure;
  iconPicker: (framework?: FrameworkProvider) => Configure;
  comment: (
    enableComment?: boolean,
    framework?: FrameworkProvider
  ) => Configure;
  schedule: (framework?: FrameworkProvider) => Configure;
  agents: (framework?: FrameworkProvider) => Configure;

  value: ViewExtensionManager;
};

const peekViewLogger = new DebugLogger('notesgraph::patch-peek-view-service');

class ViewProvider {
  static instance: ViewProvider | null = null;
  static getInstance() {
    if (!ViewProvider.instance) {
      ViewProvider.instance = new ViewProvider();
    }
    return ViewProvider.instance;
  }

  private readonly _manager: ViewExtensionManager;

  // Plugin-contributed view-extension providers currently registered on the
  // manager, tracked so {@link syncPluginProviders} can diff against them.
  private readonly _pluginProviders = new Set<unknown>();

  constructor() {
    this._manager = new ViewExtensionManager([
      ...getInternalViewExtensions(),

      NotesGraphThemeViewExtension,
      NotesGraphEditorViewExtension,
      NotesGraphEditorConfigViewExtension,
      NotesGraphIconPickerExtension,
      CodeBlockPreviewViewExtension,
      EdgelessBlockHeaderConfigViewExtension,
      TurboRendererViewExtension,
      CloudViewExtension,
      PdfViewExtension,
      MobileViewExtension,
      // AIViewExtension is added lazily by the editor host (see lit-adaper.tsx).
      ScheduleViewExtension,
      AgentsViewExtension,
      ElectronViewExtension,
      NotesGraphLinkPreviewExtension,
      NotesGraphDatabaseViewExtension,
      CommentViewExtension,
      // Last so its `notesgraph:page` view override wins over the default page root.
      OutlineZoomViewExtension,
    ]);
  }

  get value() {
    return this._manager;
  }

  /**
   * Reconcile the plugin-contributed view-extension providers registered on the
   * manager with `providers`. `ExtensionManager.get(scope)` rebuilds from the
   * provider set, so additions/removals take effect on the next spec
   * resolution. Idempotent — safe to call on every render.
   */
  syncPluginProviders(providers: unknown[]) {
    type ProviderClass = Parameters<ViewExtensionManager['addProvider']>[0];
    const next = new Set(providers);
    for (const provider of this._pluginProviders) {
      if (!next.has(provider)) {
        this._manager.removeProvider(provider as ProviderClass);
        this._pluginProviders.delete(provider);
      }
    }
    for (const provider of next) {
      if (!this._pluginProviders.has(provider)) {
        this._manager.addProvider(provider as ProviderClass);
        this._pluginProviders.add(provider);
      }
    }
  }

  get config(): Configure {
    return {
      init: this._initDefaultConfig,
      foundation: this._configureFoundation,
      editorView: this._configureEditorView,
      theme: this._configureTheme,
      editorConfig: this._configureEditorConfig,
      edgelessBlockHeader: this._configureEdgelessBlockHeader,
      database: this._configureDatabase,
      linkedDoc: this._configureLinkedDoc,
      paragraph: this._configureParagraph,
      cloud: this._configureCloud,
      turboRenderer: this._configureTurboRenderer,
      pdf: this._configurePdf,
      mobile: this._configureMobile,
      ai: this._configureAI,
      electron: this._configureElectron,
      linkPreview: this._configureLinkPreview,
      codeBlockPreview: this._configureCodeBlockHtmlPreview,
      iconPicker: this._configureIconPicker,
      comment: this._configureComment,
      schedule: this._configureSchedule,
      agents: this._configureAgents,
      value: this._manager,
    };
  }

  private readonly _initDefaultConfig = () => {
    this.config
      .foundation()
      .theme()
      .editorView()
      .editorConfig()
      .edgelessBlockHeader()
      .database()
      .linkedDoc()
      .paragraph()
      .cloud()
      .turboRenderer()
      .pdf()
      .mobile()
      .ai()
      .electron()
      .linkPreview()
      .codeBlockPreview()
      .iconPicker()
      .comment();

    return this.config;
  };

  private readonly _configureFoundation = (framework?: FrameworkProvider) => {
    const peekViewService = framework?.get(PeekViewService);

    this._manager.configure(FoundationViewExtension, {
      telemetry: {
        track: (eventName, props) => {
          tracker.track(eventName, props);
        },
      },
      fontConfig: NotesGraphCanvasTextFonts.map(font => ({
        ...font,
        url: environment.publicPath + 'fonts/' + font.url.split('/').pop(),
      })),
      peekView: !peekViewService
        ? undefined
        : ({
            peek: (
              element: {
                target: HTMLElement;
                docId: string;
                blockIds?: string[];
                template?: TemplateResult;
              },
              options?: PeekOptions
            ) => {
              peekViewLogger.debug('center peek', element);
              const { template, target, ...props } = element;

              return peekViewService.peekView.open(
                {
                  element: target,
                  docRef: props,
                },
                template,
                options?.abortSignal
              );
            },
          } satisfies BSPeekViewService),
    });

    return this.config;
  };

  private readonly _configureEditorView = (
    options?: NotesGraphEditorViewOptions
  ) => {
    this._manager.configure(NotesGraphEditorViewExtension, options);
    return this.config;
  };

  private readonly _configureTheme = (framework?: FrameworkProvider) => {
    this._manager.configure(NotesGraphThemeViewExtension, { framework });
    return this.config;
  };

  private readonly _configureEditorConfig = (framework?: FrameworkProvider) => {
    this._manager.configure(NotesGraphEditorConfigViewExtension, { framework });
    return this.config;
  };

  private readonly _configureEdgelessBlockHeader = (
    options?: EdgelessBlockHeaderViewOptions
  ) => {
    this._manager.configure(EdgelessBlockHeaderConfigViewExtension, options);
    return this.config;
  };

  private readonly _configureDatabase = (framework?: FrameworkProvider) => {
    this._manager.configure(NotesGraphDatabaseViewExtension, { framework });
    if (framework) {
      this._manager.configure(
        DatabaseViewExtension,
        createDatabaseOptionsConfig(framework)
      );
    }
    return this.config;
  };

  private readonly _configureLinkedDoc = (framework?: FrameworkProvider) => {
    if (framework) {
      this._manager.configure(
        LinkedDocViewExtension,
        createLinkedWidgetConfig(framework)
      );
    }
    return this.config;
  };

  private readonly _configureParagraph = (enableAI?: boolean) => {
    if (BUILD_CONFIG.isMobileEdition) {
      this._manager.configure(ParagraphViewExtension, {
        getPlaceholder: model => {
          const placeholders = {
            text: '',
            h1: 'Heading 1',
            h2: 'Heading 2',
            h3: 'Heading 3',
            h4: 'Heading 4',
            h5: 'Heading 5',
            h6: 'Heading 6',
            quote: '',
          };
          return placeholders[model.props.type] ?? '';
        },
      });
    } else if (enableAI) {
      this._manager.configure(ParagraphViewExtension, {
        getPlaceholder: model => {
          const placeholders = {
            text: "Type '/' for commands, 'space' for AI",
            h1: 'Heading 1',
            h2: 'Heading 2',
            h3: 'Heading 3',
            h4: 'Heading 4',
            h5: 'Heading 5',
            h6: 'Heading 6',
            quote: '',
          };
          return placeholders[model.props.type] ?? '';
        },
      });
    }
    return this.config;
  };

  private readonly _configureCloud = (
    framework?: FrameworkProvider,
    enableCloud?: boolean
  ) => {
    this._manager.configure(CloudViewExtension, { framework, enableCloud });
    return this.config;
  };

  private readonly _configureTurboRenderer = (
    enableTurboRenderer?: boolean
  ) => {
    this._manager.configure(TurboRendererViewExtension, {
      enableTurboRenderer,
    });
    return this.config;
  };

  private readonly _configurePdf = (
    enablePDFEmbedPreview?: boolean,
    reactToLit?: ReactToLit
  ) => {
    this._manager.configure(PdfViewExtension, {
      enablePDFEmbedPreview,
      reactToLit,
    });
    return this.config;
  };

  private readonly _configureMobile = (framework?: FrameworkProvider) => {
    this._manager.configure(MobileViewExtension, { framework });
    return this.config;
  };

  // The AI view extension is loaded lazily (see ensureAIViewExtension below);
  // until it arrives this is a no-op. Editor hosts re-run spec resolution once
  // the extension registers, so this configure call then takes effect.
  private readonly _configureAI = (
    enable?: boolean,
    framework?: FrameworkProvider
  ) => {
    if (aiViewExtension) {
      this._manager.configure(aiViewExtension, { framework, enable });
    }
    return this.config;
  };

  private readonly _configureElectron = (framework?: FrameworkProvider) => {
    this._manager.configure(ElectronViewExtension, { framework });
    return this.config;
  };

  private readonly _configureLinkPreview = (framework?: FrameworkProvider) => {
    this._manager.configure(NotesGraphLinkPreviewExtension, { framework });
    return this.config;
  };

  private readonly _configureCodeBlockHtmlPreview = (
    framework?: FrameworkProvider
  ) => {
    this._manager.configure(CodeBlockPreviewViewExtension, { framework });
    return this.config;
  };

  private readonly _configureIconPicker = (framework?: FrameworkProvider) => {
    this._manager.configure(NotesGraphIconPickerExtension, { framework });
    return this.config;
  };

  private readonly _configureComment = (
    enableComment?: boolean,
    framework?: FrameworkProvider
  ) => {
    this._manager.configure(CommentViewExtension, {
      enableComment,
      framework,
    });

    this._manager.configure(InlineCommentViewExtension, {
      enabled: enableComment,
    });

    return this.config;
  };

  private readonly _configureSchedule = (framework?: FrameworkProvider) => {
    this._manager.configure(ScheduleViewExtension, { framework });
    return this.config;
  };

  private readonly _configureAgents = (framework?: FrameworkProvider) => {
    this._manager.configure(AgentsViewExtension, { framework });
    return this.config;
  };
}

export function getViewManager() {
  return ViewProvider.getInstance();
}

// ---- lazy AI view extension -------------------------------------------------
// The AI feature (~9MB) is dynamic-imported so it stays out of the initial
// bundle. Loaded at most once per app. The provider is registered DIRECTLY on
// the manager — not through syncPluginProviders — so plugin reconciliation
// (which removes providers absent from its list) can never drop it, no matter
// how many editor instances with differing states are mounted. Its editor
// custom-element effects are registered in the same step to keep ordering.

type AIViewExtensionClass =
  typeof import('@notesgraph/core/blocksuite/view-extensions/ai').AIViewExtension;

let aiViewExtension: AIViewExtensionClass | null = null;
let aiViewExtensionLoading: Promise<AIViewExtensionClass> | null = null;

export function ensureAIViewExtension(): Promise<AIViewExtensionClass> {
  aiViewExtensionLoading ??= Promise.all([
    import('@notesgraph/core/blocksuite/view-extensions/ai'),
    import('@notesgraph/core/blocksuite/ai/effects/editor'),
  ]).then(([extModule, effectsModule]) => {
    effectsModule.registerAIEditorEffects();
    aiViewExtension = extModule.AIViewExtension;
    ViewProvider.getInstance().value.addProvider(extModule.AIViewExtension);
    return extModule.AIViewExtension;
  });
  return aiViewExtensionLoading;
}
