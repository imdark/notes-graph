import { appendParagraphCommand } from '@blocksuite/notesgraph/blocks/paragraph';
import type { DocTitle } from '@blocksuite/notesgraph/fragments/doc-title';
import { DisposableGroup } from '@blocksuite/notesgraph/global/disposable';
import { IS_LINUX } from '@blocksuite/notesgraph/global/env';
import type { DocMode, RootBlockModel } from '@blocksuite/notesgraph/model';
import {
  customImageProxyMiddleware,
  ImageProxyService,
} from '@blocksuite/notesgraph/shared/adapters';
import { focusBlockEnd } from '@blocksuite/notesgraph/shared/commands';
import { getLastNoteBlock } from '@blocksuite/notesgraph/shared/utils';
import type { BlockStdScope, EditorHost } from '@blocksuite/notesgraph/std';
import type { Store } from '@blocksuite/notesgraph/store';
import { EditorLoading } from '@notesgraph/component/page-detail-skeleton';
import type {
  EdgelessEditor,
  PageEditor,
} from '@notesgraph/core/blocksuite/editors';
import {
  type DocModeEditorComponent,
  DocModeRegistryService,
} from '@notesgraph/core/modules/doc-mode-registry';
import {
  EditorSettingService,
  fontStyleOptions,
} from '@notesgraph/core/modules/editor-setting';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { LinkCardService } from '@notesgraph/core/modules/link-card';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { Slot } from '@radix-ui/react-slot';
import { cssVar } from '@toeverything/theme';
import clsx from 'clsx';
import type { CSSProperties, HTMLAttributes } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DefaultOpenProperty } from '../../components/properties';
import { BlocksuiteDocEditor } from './lit-adaper';
import * as styles from './styles.css';

export interface NotesGraphEditorContainer extends HTMLElement {
  page: Store;
  doc: Store;
  docTitle: DocTitle;
  host?: EditorHost;
  model: RootBlockModel | null;
  updateComplete: Promise<boolean>;
  mode: DocMode;
  origin: HTMLDivElement;
  std: BlockStdScope;
}

export interface EditorProps extends HTMLAttributes<HTMLDivElement> {
  page: Store;
  mode: DocMode;
  shared?: boolean;
  /** shared page whose link grants read + comment */
  sharedCommentable?: boolean;
  readonly?: boolean;
  defaultOpenProperty?: DefaultOpenProperty;
  // on Editor ready
  onEditorReady?: (editor: NotesGraphEditorContainer) => (() => void) | void;
}

const BlockSuiteEditorImpl = ({
  mode: modeProp,
  page,
  className,
  shared,
  sharedCommentable,
  readonly,
  style,
  onEditorReady,
  defaultOpenProperty,
  ...props
}: EditorProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PageEditor | EdgelessEditor | null>(null);
  const docTitleRef = useRef<DocTitle>(null);
  const modes = useLiveData(useService(DocModeRegistryService).modes$);
  // Render the editor for the requested mode if that mode is registered;
  // otherwise fall back to page (e.g. an edgeless-saved doc opened while the
  // edgeless plugin is disabled).
  const activeMode = modes.find(descriptor => descriptor.id === modeProp);
  const mode: DocMode = activeMode ? modeProp : 'page';
  const Editor = (activeMode?.editor ??
    BlocksuiteDocEditor) as DocModeEditorComponent;
  const featureFlags = useService(FeatureFlagService).flags;
  const enableEditorRTL = useLiveData(featureFlags.enable_editor_rtl.$);
  const editorSetting = useService(EditorSettingService).editorSetting;
  const linkCardService = useService(LinkCardService);

  const { enableMiddleClickPaste } = useLiveData(
    editorSetting.settings$.selector(s => ({
      enableMiddleClickPaste: s.enableMiddleClickPaste,
    }))
  );

  /**
   * mimic an NotesGraphEditorContainer using proxy
   */
  const notesgraphEditorContainerProxy = useMemo(() => {
    const api = {
      get page() {
        return page;
      },
      get doc() {
        return page;
      },
      get docTitle() {
        return docTitleRef.current;
      },
      get host() {
        return editorRef.current?.host ?? null;
      },
      get model() {
        return page.root as any;
      },
      get updateComplete() {
        return editorRef.current?.updateComplete;
      },
      get mode() {
        return mode;
      },
      get origin() {
        return rootRef.current;
      },
      get std() {
        return editorRef.current?.std;
      },
    };

    const proxy = new Proxy(api, {
      has(_, prop) {
        return (
          Reflect.has(api, prop) ||
          (rootRef.current ? Reflect.has(rootRef.current, prop) : false)
        );
      },
      get(_, prop) {
        if (Reflect.has(api, prop)) {
          return api[prop as keyof typeof api];
        }
        if (rootRef.current && Reflect.has(rootRef.current, prop)) {
          const maybeFn = Reflect.get(rootRef.current, prop);
          if (typeof maybeFn === 'function') {
            return maybeFn.bind(rootRef.current);
          } else {
            return maybeFn;
          }
        }
        return undefined;
      },
    }) as NotesGraphEditorContainer;

    return proxy;
  }, [mode, page]);

  const handleClickPageModeBlank = useCallback(() => {
    if (shared || readonly || page.readonly) return;
    const std = notesgraphEditorContainerProxy.host?.std;
    if (!std) {
      return;
    }
    const note = getLastNoteBlock(page);
    if (note) {
      const lastBlock = note.lastChild();
      if (
        lastBlock &&
        lastBlock.flavour === 'notesgraph:paragraph' &&
        lastBlock.text?.length === 0
      ) {
        const focusBlock = std.view.getBlock(lastBlock.id) ?? undefined;
        std.command.exec(focusBlockEnd, {
          focusBlock,
          force: true,
        });
        return;
      }
    }

    std.command.exec(appendParagraphCommand);
  }, [notesgraphEditorContainerProxy.host?.std, page, readonly, shared]);

  useEffect(() => {
    const editorContainer = rootRef.current;
    if (editorContainer) {
      const handleMiddleClick = (e: MouseEvent) => {
        if (
          e.target instanceof HTMLElement &&
          (e.target.closest('notesgraph-reference') ||
            e.target.closest('notesgraph-link'))
        ) {
          return;
        }
        if (!enableMiddleClickPaste && IS_LINUX && e.button === 1) {
          e.preventDefault();
        }
      };
      editorContainer.addEventListener('pointerup', handleMiddleClick, {
        capture: true,
      });
      editorContainer.addEventListener('auxclick', handleMiddleClick, {
        capture: true,
      });
      return () => {
        editorContainer?.removeEventListener('pointerup', handleMiddleClick, {
          capture: true,
        });
        editorContainer?.removeEventListener('auxclick', handleMiddleClick, {
          capture: true,
        });
      };
    }
    return;
  }, [enableMiddleClickPaste]);

  useEffect(() => {
    const editor = notesgraphEditorContainerProxy;
    globalThis.currentEditor = editor;
    const disposableGroup = new DisposableGroup();
    let canceled = false;

    // provide image proxy endpoint to blocksuite — route through the link-card
    // renderer (local sidecar on web) so external images load without the
    // hosted backend.
    const imageProxyUrl = `${linkCardService.baseUrl}/clip/image-proxy`;

    editor.std.clipboard.use(customImageProxyMiddleware(imageProxyUrl));
    const imageProxyService = page.get(ImageProxyService);
    imageProxyService.setImageProxyURL(imageProxyUrl);
    // Desktop link cards are returned as data: URLs — let them render directly
    // instead of being routed through the (absent) image proxy.
    const buildUrl = imageProxyService.buildUrl.bind(imageProxyService);
    imageProxyService.buildUrl = (url: string) =>
      url.startsWith('data:') ? url : buildUrl(url);

    editor.updateComplete
      .then(() => {
        if (onEditorReady && !canceled) {
          const dispose = onEditorReady(editor);
          if (dispose) {
            disposableGroup.add(dispose);
          }
        }
      })
      .catch(error => {
        console.error('Error updating editor', error);
      });

    return () => {
      canceled = true;
      disposableGroup.dispose();
    };
  }, [notesgraphEditorContainerProxy, onEditorReady, page, linkCardService]);

  return (
    <div
      {...props}
      data-testid={`editor-${page.id}`}
      dir={enableEditorRTL ? 'rtl' : 'ltr'}
      className={clsx(
        `editor-wrapper ${mode}-mode`,
        styles.docEditorRoot,
        className
      )}
      style={style}
      data-notesgraph-editor-container
      ref={rootRef}
    >
      <Editor
        ref={editorRef}
        shared={shared}
        sharedCommentable={sharedCommentable}
        page={page}
        readonly={readonly}
        titleRef={docTitleRef}
        onClickBlank={handleClickPageModeBlank}
        defaultOpenProperty={defaultOpenProperty}
      />
    </div>
  );
};

export const BlockSuiteEditor = (props: EditorProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [longerLoading, setLongerLoading] = useState(false);
  // eslint-disable-next-line react-hooks/purity
  const [loadStartTime] = useState(Date.now());
  const workspaceService = useService(WorkspaceService);

  const editorSetting = useService(EditorSettingService).editorSetting;
  const settings = useLiveData(
    editorSetting.settings$.selector(s => ({
      fontFamily: s.fontFamily,
      customFontFamily: s.customFontFamily,
      fullWidthLayout: s.fullWidthLayout,
    }))
  );
  const fontFamily = useMemo(() => {
    const fontStyle = fontStyleOptions.find(
      option => option.key === settings.fontFamily
    );
    if (!fontStyle) {
      return cssVar('fontSansFamily');
    }
    const customFontFamily = settings.customFontFamily;

    return customFontFamily && fontStyle.key === 'Custom'
      ? `${customFontFamily}, ${fontStyle.value}`
      : fontStyle.value;
  }, [settings.customFontFamily, settings.fontFamily]);

  useEffect(() => {
    if (props.page.root) {
      setIsLoading(false);
      return;
    }

    const disposable = props.page.slots.rootAdded.subscribe(() => {
      disposable.unsubscribe();
      setIsLoading(false);
      setLongerLoading(false);
    });
    return () => {
      disposable.unsubscribe();
    };
  }, [loadStartTime, props.page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        setLongerLoading(true);
      }
    }, 20 * 1000);
    const reportErrorTimer = setTimeout(() => {
      if (isLoading) {
        track.doc.$.$.loadDoc({
          workspaceId: props.page.workspace.id,
          docId: props.page.id,
          time: Date.now() - loadStartTime,
          success: false,
        });
      }
    }, 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearTimeout(reportErrorTimer);
    };
  }, [isLoading, loadStartTime, props.page]);

  useEffect(() => {
    workspaceService.workspace.engine.doc
      .waitForDocLoaded(props.page.id)
      .then(() => {
        track.doc.$.$.loadDoc({
          workspaceId: props.page.workspace.id,
          docId: props.page.id,
          time: Date.now() - loadStartTime,
          success: true,
        });
      })
      .catch(() => {
        track.doc.$.$.loadDoc({
          workspaceId: props.page.workspace.id,
          docId: props.page.id,
          time: Date.now() - loadStartTime,
          success: false,
        });
      });
  }, [loadStartTime, props.page, workspaceService]);

  return (
    <Slot style={{ '--notesgraph-font-family': fontFamily } as CSSProperties}>
      {isLoading ? (
        <EditorLoading longerLoading={longerLoading} />
      ) : (
        <BlockSuiteEditorImpl key={props.page.id} {...props} />
      )}
    </Slot>
  );
};
