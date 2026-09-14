import {
  CaptionIcon,
  CopyAsImgaeIcon,
  CopyIcon,
  EditIcon,
  ExportToMarkdownIcon,
  LinkIcon,
  OpenInNewIcon,
} from '@blocksuite/icons/lit';
import { BookmarkBlockComponent } from '@blocksuite/notesgraph/blocks/bookmark';
import {
  EmbedFigmaBlockComponent,
  EmbedGithubBlockComponent,
  EmbedIframeBlockComponent,
  EmbedLoomBlockComponent,
  EmbedYoutubeBlockComponent,
  getDocContentWithMaxLength,
} from '@blocksuite/notesgraph/blocks/embed';
import {
  EmbedLinkedDocBlockComponent,
  EmbedSyncedDocBlockComponent,
} from '@blocksuite/notesgraph/blocks/embed-doc';
import { SurfaceRefBlockComponent } from '@blocksuite/notesgraph/blocks/surface-ref';
import { toggleEmbedCardEditModal } from '@blocksuite/notesgraph/components/embed-card-modal';
import { notifyLinkedDocClearedAliases } from '@blocksuite/notesgraph/components/notification';
import { isPeekable, peek } from '@blocksuite/notesgraph/components/peek';
import { toast } from '@blocksuite/notesgraph/components/toast';
import {
  EditorChevronDown,
  type MenuContext,
  type MenuItemGroup,
} from '@blocksuite/notesgraph/components/toolbar';
import { watch } from '@blocksuite/notesgraph/global/lit';
import { NotesGraphLink } from '@blocksuite/notesgraph/inlines/link';
import {
  NotesGraphReference,
  toggleReferencePopup,
} from '@blocksuite/notesgraph/inlines/reference';
import {
  BookmarkBlockModel,
  EmbedIframeBlockModel,
  EmbedLinkedDocModel,
  EmbedSyncedDocModel,
  SurfaceRefBlockSchema,
} from '@blocksuite/notesgraph/model';
import {
  draftSelectedModelsCommand,
  getSelectedModelsCommand,
} from '@blocksuite/notesgraph/shared/commands';
import { ImageSelection } from '@blocksuite/notesgraph/shared/selection';
import {
  ActionPlacement,
  CitationProvider,
  EmbedIframeService,
  EmbedOptionProvider,
  GenerateDocUrlProvider,
  isRemovedUserInfo,
  LinkPreviewServiceIdentifier,
  OpenDocExtensionIdentifier,
  type OpenDocMode,
  type ToolbarAction,
  type ToolbarActionGenerator,
  type ToolbarActionGroup,
  type ToolbarActionGroupGenerator,
  type ToolbarContext,
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
  UserProvider,
} from '@blocksuite/notesgraph/shared/services';
import { matchModels } from '@blocksuite/notesgraph/shared/utils';
import {
  BlockFlavourIdentifier,
  BlockSelection,
  TextSelection,
} from '@blocksuite/notesgraph/std';
import {
  GfxBlockElementModel,
  GfxPrimitiveElementModel,
} from '@blocksuite/notesgraph/std/gfx';
import { type ExtensionType, Slice } from '@blocksuite/notesgraph/store';
import { notify } from '@notesgraph/component';
import {
  generateUrl,
  type UseSharingUrl,
} from '@notesgraph/core/components/hooks/notesgraph/use-share-url';
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud';
import { EditorService } from '@notesgraph/core/modules/editor';
import type { EditorSettingExt } from '@notesgraph/core/modules/editor-setting/entities/editor-setting';
import type { ClipMode } from '@notesgraph/core/modules/link-card';
import {
  isYoutubeVideoUrl,
  VideoIngestionService,
} from '@notesgraph/core/modules/video-ingestion';
import { copyLinkToBlockStdScopeClipboard } from '@notesgraph/core/utils/clipboard';
import { I18n, i18nTime } from '@notesgraph/i18n';
import type { FrameworkProvider } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { computed, signal } from '@preact/signals-core';
import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { getContentFromSlice } from '../../../utils/markdown-utils';
import { openDocActions } from '../../editor-view/open-doc';
import { copyAsImage, createCopyAsPngMenuItem } from './copy-as-image';

export function createToolbarMoreMenuConfig(framework: FrameworkProvider) {
  return {
    configure: <T extends MenuContext>(groups: MenuItemGroup<T>[]) => {
      const clipboardGroup = groups.find(group => group.type === 'clipboard');

      if (clipboardGroup) {
        let copyIndex = clipboardGroup.items.findIndex(
          item => item.type === 'copy'
        );
        if (copyIndex === -1) {
          copyIndex = clipboardGroup.items.findIndex(
            item => item.type === 'duplicate'
          );
          if (copyIndex !== -1) {
            copyIndex -= 1;
          }
        }

        // after `copy` or before `duplicate`
        clipboardGroup.items.splice(
          copyIndex + 1,
          0,
          createCopyLinkToBlockMenuItem(framework)
        );

        clipboardGroup.items.splice(
          copyIndex + 1,
          0,
          createCopyAsPngMenuItem(framework)
        );

        clipboardGroup.items.splice(
          copyIndex + 1,
          0,
          createCopyAsMarkdownMenuItem(framework)
        );
      }

      return groups;
    },
  };
}

function createCopyLinkToBlockMenuItem(
  framework: FrameworkProvider,
  item = {
    icon: LinkIcon({ width: '20', height: '20' }),
    label: 'Copy link to block',
    type: 'copy-link-to-block',
    when: (ctx: MenuContext) => {
      if (ctx.isEmpty()) return false;

      const { editor } = framework.get(EditorService);
      const mode = editor.mode$.value;

      if (mode === 'edgeless') {
        // linking blocks in notes is currently not supported in edgeless mode.
        if (ctx.selectedBlockModels.length > 0) {
          return false;
        }

        // linking single block/element in edgeless mode.
        if (ctx.isMultiple()) {
          return false;
        }
      }

      return true;
    },
  }
) {
  return {
    ...item,
    action: async (ctx: MenuContext) => {
      const workspaceServerService = framework.get(WorkspaceServerService);

      const { editor } = framework.get(EditorService);
      const mode = editor.mode$.value;
      const pageId = editor.doc.id;
      const workspaceId = editor.doc.workspace.id;
      const options: UseSharingUrl = { workspaceId, pageId, mode };
      let type = '';

      if (mode === 'page') {
        // maybe multiple blocks
        const blockIds = ctx.selectedBlockModels.map(model => model.id);
        options.blockIds = blockIds;
        type = ctx.selectedBlockModels[0].flavour;
      } else if (mode === 'edgeless' && ctx.firstElement) {
        // single block/element
        const id = ctx.firstElement.id;
        if (ctx.isElement()) {
          options.elementIds = [id];
          type = (ctx.firstElement as GfxPrimitiveElementModel).type;
        } else {
          options.blockIds = [id];
          type = (ctx.firstElement as GfxBlockElementModel).flavour;
        }
      }

      const str = generateUrl({
        ...options,
        baseUrl: workspaceServerService.server?.baseUrl ?? location.origin,
      });
      if (!str) {
        ctx.close();
        return;
      }

      const success = await copyLinkToBlockStdScopeClipboard(
        str,
        ctx.std.clipboard
      );

      if (success) {
        notify.success({ title: I18n['Copied link to clipboard']() });
      }

      track.doc.editor.toolbar.copyBlockToLink({ type });

      ctx.close();
    },
  };
}

function createCopyAsMarkdownMenuItem(
  _framework: FrameworkProvider,
  item = {
    icon: ExportToMarkdownIcon({ width: '20', height: '20' }),
    label: I18n['com.notesgraph.export.copy-markdown'](),
    type: 'copy-as-markdown',
    when: (ctx: MenuContext) => {
      if (ctx.isEmpty()) return false;
      return true;
    },
  }
) {
  return {
    ...item,
    action: (ctx: MenuContext) => {
      void (async () => {
        const { std } = ctx;
        const [ok, commandCtx] = std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(draftSelectedModelsCommand)
          .run();
        const draftedModels = commandCtx.draftedModels;
        if (!ok || !draftedModels) {
          return;
        }

        const models = await draftedModels;
        if (models.length > 0) {
          const slice = Slice.fromModels(std.store, models);
          const markdown = await getContentFromSlice(
            std.host,
            slice,
            'markdown'
          );
          if (markdown) {
            await navigator.clipboard.writeText(markdown);
            toast(std.host, I18n['com.notesgraph.export.copied-as-markdown']());
          }
        }
      })()
        .catch(console.error)
        .finally(() => {
          ctx.close();
        });
    },
  };
}

function createToolbarMoreMenuConfigV2(baseUrl?: string) {
  return {
    actions: [
      {
        placement: ActionPlacement.More,
        id: 'a.clipboard',
        actions: [
          {
            id: 'copy-as-image',
            label: 'Copy as Image',
            icon: CopyAsImgaeIcon(),
            when: ({ isEdgelessMode, gfx, flags }) =>
              !flags.isHovering() &&
              isEdgelessMode &&
              gfx.selection.selectedElements.length > 0,
            run: ({ std }) => {
              copyAsImage(std);
            },
          },
          {
            id: 'copy-as-markdown',
            label: I18n['com.notesgraph.export.copy-markdown'](),
            icon: ExportToMarkdownIcon(),
            when: ({ gfx, flags, isPageMode }) => {
              if (flags.isHovering()) return false;
              if (isPageMode) return true;
              return gfx.selection.selectedElements.length > 0;
            },
            run: ({ std }) => {
              void (async () => {
                const [ok, ctx] = std.command
                  .chain()
                  .pipe(getSelectedModelsCommand)
                  .pipe(draftSelectedModelsCommand)
                  .run();
                const draftedModels = ctx.draftedModels;
                if (!ok || !draftedModels) {
                  return;
                }

                const models = await draftedModels;
                if (models.length > 0) {
                  const slice = Slice.fromModels(std.store, models);
                  const markdown = await getContentFromSlice(
                    std.host,
                    slice,
                    'markdown'
                  );
                  if (markdown) {
                    await navigator.clipboard.writeText(markdown);
                    toast(
                      std.host,
                      I18n['com.notesgraph.export.copied-as-markdown']()
                    );
                  }
                }
              })().catch(console.error);
            },
          },
          {
            id: 'copy-link-to-block',
            label: 'Copy link to block',
            icon: LinkIcon(),
            when: ({ isPageMode, selection, gfx, flags }) => {
              if (flags.isHovering()) return false;

              const items = selection
                .getGroup('note')
                .filter(item =>
                  [TextSelection, BlockSelection, ImageSelection].some(t =>
                    item.is(t)
                  )
                );
              const hasNoteSelection = items.length > 0;

              if (isPageMode) {
                const item = items[0];
                if (item && item.is(TextSelection)) {
                  return (
                    !item.isCollapsed() &&
                    Boolean(item.from.length + (item.to?.length ?? 0))
                  );
                }
                return hasNoteSelection;
              }

              // Linking blocks in notes is currently not supported under edgeless.
              if (hasNoteSelection) return false;

              // Linking single block/element in edgeless mode.
              return gfx.selection.selectedElements.length === 1;
            },
            run({ isPageMode, std, store, gfx, workspace, editorMode }) {
              const pageId = store.doc.id;
              const mode = editorMode;
              const workspaceId = workspace.id;
              const options: UseSharingUrl = { workspaceId, pageId, mode };
              let type = '';

              if (isPageMode) {
                const [ok, { selectedModels = [] }] = std.command.exec(
                  getSelectedModelsCommand
                );

                if (!ok || !selectedModels.length) return;

                options.blockIds = selectedModels.map(model => model.id);
                type = selectedModels[0].flavour;
              } else {
                const firstElement = gfx.selection.firstElement;
                if (!firstElement) return;

                const ids = [firstElement.id];
                if (firstElement instanceof GfxPrimitiveElementModel) {
                  type = firstElement.type;
                  options.elementIds = ids;
                } else if (firstElement instanceof GfxBlockElementModel) {
                  type = firstElement.flavour;
                  options.blockIds = ids;
                }
              }

              if (!type) return;

              const str = generateUrl({
                ...options,
                baseUrl: baseUrl ?? location.origin,
              });

              if (!str) return;

              copyLinkToBlockStdScopeClipboard(str, std.clipboard)
                .then(ok => {
                  if (!ok) return;

                  notify.success({ title: I18n['Copied link to clipboard']() });
                })
                .catch(console.error);

              track.doc.editor.toolbar.copyBlockToLink({ type });
            },
          },
        ],
      },
      {
        placement: ActionPlacement.More,
        id: 'z.block-meta',
        actions: [
          {
            id: 'block-meta-display',
            when: ctx => {
              const isEnabled = ctx.features.getFlag('enable_block_meta');
              if (!isEnabled) return false;

              // only display when one block is selected by block selection
              const hasBlockSelection =
                ctx.selection.filter(BlockSelection).length === 1;
              if (!hasBlockSelection) return false;
              const model = ctx.getCurrentModelBy(BlockSelection);
              if (!model) return false;

              const createdAt = 'meta:createdAt';
              const createdBy = 'meta:createdBy';
              return (
                'props' in model &&
                createdAt in model.props &&
                model.props[createdAt] !== undefined &&
                createdBy in model.props &&
                model.props[createdBy] !== undefined &&
                typeof model.props[createdBy] === 'string' &&
                typeof model.props[createdAt] === 'number'
              );
            },
            content: ctx => {
              const model = ctx.getCurrentModelBy(BlockSelection);
              if (!model) return null;
              if (!('props' in model)) return null;
              const createdAt = 'meta:createdAt';
              if (!(createdAt in model.props)) return null;
              const createdBy = 'meta:createdBy';
              if (!(createdBy in model.props)) return null;
              const createdByUserId = model.props[createdBy] as string;
              const createdAtTimestamp = model.props[createdAt] as number;
              const date = new Date(createdAtTimestamp);
              const userProvider = ctx.std.getOptional(UserProvider);
              if (!userProvider) return null;
              userProvider.revalidateUserInfo(createdByUserId);
              const userSignal = userProvider.userInfo$(createdByUserId);
              const isLoadingSignal = userProvider.isLoading$(createdByUserId);
              const name = computed(() => {
                const value = userSignal.value;
                if (!value) {
                  if (isLoadingSignal.value) {
                    // if user info is loading
                    return '';
                  }
                  return I18n['Unknown User']();
                }
                const removed = isRemovedUserInfo(value);
                if (removed) {
                  return I18n['Deleted User']();
                }
                return value.name;
              });
              const user = computed(() => {
                return I18n.t('com.notesgraph.page.toolbar.created_by', {
                  name: name.value,
                });
              });
              const createdAtString = i18nTime(date.toISOString(), {
                absolute: {
                  accuracy: 'minute',
                },
              });
              const wrapperStyle = {
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: '400',
              };
              return html`<div style=${styleMap(wrapperStyle)}>
                <div>${watch(user)}</div>
                <div>${createdAtString}</div>
              </div>`;
            },
          },
        ],
      },
    ],

    when: ctx => !ctx.getSurfaceModels().some(model => model.isLocked()),
  } as const satisfies ToolbarModuleConfig;
}

function createExternalLinkableToolbarConfig(
  klass:
    | typeof BookmarkBlockComponent
    | typeof EmbedFigmaBlockComponent
    | typeof EmbedGithubBlockComponent
    | typeof EmbedLoomBlockComponent
    | typeof EmbedYoutubeBlockComponent
) {
  return {
    actions: [
      {
        id: 'a.preview.after.copy-link-and-edit',
        actions: [
          {
            id: 'copy-link',
            tooltip: 'Copy link',
            icon: CopyIcon(),
            run(ctx) {
              const model = ctx.getCurrentBlockByType(klass)?.model;
              if (!model) return;

              const { url } = model.props;

              navigator.clipboard.writeText(url).catch(console.error);
              toast(ctx.host, 'Copied link to clipboard');

              ctx.track('CopiedLink', {
                category: matchModels(model, [BookmarkBlockModel])
                  ? 'bookmark'
                  : 'link',
                type: 'card view',
                control: 'copy link',
              });
            },
          },
          {
            id: 'edit',
            tooltip: 'Edit',
            icon: EditIcon(),
            run(ctx) {
              const block = ctx.getCurrentBlockByType(klass);
              if (!block) return;

              ctx.hide();

              const model = block.model;
              const abortController = new AbortController();
              abortController.signal.onabort = () => ctx.show();

              toggleEmbedCardEditModal(
                ctx.host,
                model,
                'card',
                undefined,
                undefined,
                (_std, _component, props) => {
                  ctx.store.updateBlock(model, props);
                  block.requestUpdate();
                  const citationService = ctx.std.get(CitationProvider);
                  if (citationService.isCitationModel(model)) {
                    citationService.trackEvent('Edit');
                  }
                },
                abortController
              );

              ctx.track('OpenedAliasPopup', {
                category: matchModels(model, [BookmarkBlockModel])
                  ? 'bookmark'
                  : 'link',
                type: 'card view',
                control: 'edit',
              });
            },
          },
        ],
      },
    ],
  } as const satisfies ToolbarModuleConfig;
}

function createOpenDocActions(
  ctx: ToolbarContext,
  target:
    | EmbedLinkedDocBlockComponent
    | EmbedSyncedDocBlockComponent
    | NotesGraphReference
    | SurfaceRefBlockComponent,
  isSameDoc: boolean,
  actions = openDocActions.map(
    ({ type: mode, label, icon, enabled: when, shortcut }, i) => ({
      mode,
      id: `${i}.${mode}`,
      label,
      icon,
      when,
      shortcut,
    })
  )
) {
  return actions
    .filter(action => action.when)
    .map<ToolbarActionGenerator & { mode: OpenDocMode; shortcut?: string }>(
      action => {
        const openMode = action.mode;
        const shouldOpenInCenterPeek = openMode === 'open-in-center-peek';
        const shouldOpenInActiveView = openMode === 'open-in-active-view';

        return {
          ...action,
          generate(ctx) {
            const disabled = shouldOpenInActiveView ? isSameDoc : false;

            const when =
              ctx.std.get(OpenDocExtensionIdentifier).isAllowed(openMode) &&
              (shouldOpenInCenterPeek ? isPeekable(target) : true);

            const run = shouldOpenInCenterPeek
              ? (_ctx: ToolbarContext) => peek(target)
              : (_ctx: ToolbarContext) => target.open({ openMode });

            return { disabled, when, run };
          },
        };
      }
    )
    .filter(action => {
      if (typeof action.when === 'function') return action.when(ctx);
      return action.when ?? true;
    });
}

function createOpenDocActionGroup(
  klass:
    | typeof EmbedLinkedDocBlockComponent
    | typeof EmbedSyncedDocBlockComponent,
  settings: EditorSettingExt
): ToolbarAction {
  return {
    placement: ActionPlacement.Start,
    id: 'A.open-doc',
    content(ctx) {
      const block = ctx.getCurrentBlockByType(klass);
      if (!block) return null;

      return renderOpenDocMenu(
        settings,
        ctx,
        block,
        block.model.props.pageId === ctx.store.id
      );
    },
  };
}

function createEdgelessOpenDocActionGroup(
  klass:
    | typeof EmbedLinkedDocBlockComponent
    | typeof EmbedSyncedDocBlockComponent
): ToolbarActionGroupGenerator {
  return {
    placement: ActionPlacement.More,
    id: 'Z.c.open-doc',
    generate(ctx) {
      const block = ctx.getCurrentBlockByType(klass);
      if (!block) return null;

      const actions = createOpenDocActions(
        ctx,
        block,
        block.model.props.pageId === ctx.store.id
      ).map(action => ({ ...action, ...action.generate(ctx) }));

      return { actions };
    },
  };
}

function createSurfaceRefToolbarConfig(baseUrl?: string): ToolbarModuleConfig {
  return {
    actions: [
      {
        id: 'b.open-surface-ref',
        when: ctx =>
          !!ctx.getCurrentBlockByType(SurfaceRefBlockComponent)?.referenceModel,
        content: ctx => {
          const surfaceRefBlock = ctx.getCurrentBlockByType(
            SurfaceRefBlockComponent
          );
          if (!surfaceRefBlock) return null;

          const actions = createOpenDocActions(ctx, surfaceRefBlock, false)
            .map(action => ({
              ...action,
              ...action.generate(ctx),
            }))
            .map(action => {
              if (action.id.endsWith('open-in-active-view')) {
                action.label =
                  I18n[
                    'com.notesgraph.peek-view-controls.open-doc-in-edgeless'
                  ]();
              }
              return action;
            });
          if (!actions.length) return null;

          const styles = styleMap({
            gap: 4,
          });

          return html`${keyed(
            surfaceRefBlock,
            html`<editor-menu-button
              aria-label="Open"
              .contentPadding=${'8px'}
              .button=${html`<editor-icon-button
                .iconSize=${'16px'}
                .iconContainerPadding=${4}
              >
                ${OpenInNewIcon()} ${EditorChevronDown}
              </editor-icon-button>`}
            >
              <div data-orientation="vertical" style=${styles}>
                ${repeat(
                  actions,
                  action => action.id,
                  ({ label, icon, run, disabled }) => html`
                    <editor-menu-action
                      aria-label=${ifDefined(label)}
                      ?disabled=${disabled}
                      @click=${() => {
                        run?.(ctx);
                      }}
                    >
                      ${icon}<span class="label">${label}</span>
                    </editor-menu-action>
                  `
                )}
              </div>
            </editor-menu-button>`
          )}`;
        },
      },
      {
        id: 'a.clipboard',
        placement: ActionPlacement.More,
        actions: [
          {
            id: 'copy-link-to-surface-ref',
            label: 'Copy original link',
            icon: LinkIcon(),
            when: ctx =>
              !!ctx.getCurrentBlockByType(SurfaceRefBlockComponent)
                ?.referenceModel,
            run: ctx => {
              const surfaceRefBlock = ctx.getCurrentBlockByType(
                SurfaceRefBlockComponent
              );
              if (!surfaceRefBlock) return;

              const refModel = surfaceRefBlock.referenceModel;
              if (!refModel) return;

              const { store, workspace, std } = ctx;
              const pageId = store.doc.id;
              const workspaceId = workspace.id;
              const options: UseSharingUrl = {
                workspaceId,
                pageId,
                mode: 'edgeless',
              };

              let type = '';
              if (refModel instanceof GfxPrimitiveElementModel) {
                options.elementIds = [refModel.id];
                type = refModel.type;
              } else if (refModel instanceof GfxBlockElementModel) {
                options.blockIds = [refModel.id];
                type = refModel.flavour;
              }

              const str = generateUrl({
                ...options,
                baseUrl: baseUrl ?? location.origin,
              });
              if (!str) return;

              copyLinkToBlockStdScopeClipboard(str, std.clipboard)
                .then(ok => {
                  if (!ok) return;

                  notify.success({ title: I18n['Copied link to clipboard']() });
                })
                .catch(console.error);

              track.doc.editor.toolbar.copyBlockToLink({ type });
            },
          },
        ],
      },
    ],

    when: ctx => ctx.isPageMode,
  };
}

function renderOpenDocMenu(
  settings: EditorSettingExt,
  ctx: ToolbarContext,
  target:
    | EmbedLinkedDocBlockComponent
    | EmbedSyncedDocBlockComponent
    | NotesGraphReference,
  isSameDoc: boolean
) {
  const actions = createOpenDocActions(ctx, target, isSameDoc).map(action => ({
    ...action,
    ...action.generate(ctx),
  }));
  if (!actions.length) return null;

  const openDocMode = computed(
    () => settings.settingSignal.value.openDocMode ?? 'open-in-active-view'
  );
  const updateOpenDocMode = (mode: OpenDocMode) =>
    settings.openDocMode.set(mode);

  return html`${keyed(
    target,
    html`
      <notesgraph-open-doc-dropdown-menu
        .actions=${actions}
        .context=${ctx}
        .openDocModeSignal=${openDocMode}
        .updateOpenDocMode=${updateOpenDocMode}
      >
      </notesgraph-open-doc-dropdown-menu>
    `
  )}`;
}

const embedLinkedDocToolbarConfig = {
  actions: [
    {
      id: 'a.doc-title.after.copy-link-and-edit',
      actions: [
        {
          id: 'copy-link',
          tooltip: 'Copy link',
          icon: CopyIcon(),
          run(ctx) {
            const model = ctx.getCurrentModelByType(EmbedLinkedDocModel);
            if (!model) return;

            const { pageId, params } = model.props;

            const url = ctx.std
              .getOptional(GenerateDocUrlProvider)
              ?.generateDocUrl(pageId, params);

            if (!url) return;

            navigator.clipboard.writeText(url).catch(console.error);
            toast(ctx.host, 'Copied link to clipboard');

            ctx.track('CopiedLink', {
              category: 'linked doc',
              type: 'card view',
              control: 'copy link',
            });
          },
        },
        {
          id: 'edit',
          tooltip: 'Edit Description',
          icon: EditIcon(),
          run(ctx) {
            const block = ctx.getCurrentBlockByType(
              EmbedLinkedDocBlockComponent
            );
            if (!block) return;

            ctx.hide();

            const model = block.model;
            const doc = ctx.workspace.getDoc(model.props.pageId)?.getStore();
            const abortController = new AbortController();
            abortController.signal.onabort = () => ctx.show();

            toggleEmbedCardEditModal(
              ctx.host,
              model,
              'card',
              doc
                ? {
                    title: doc.meta?.title,
                    description: getDocContentWithMaxLength(doc),
                  }
                : undefined,
              std => {
                block.refreshData();
                notifyLinkedDocClearedAliases(std);
              },
              (_std, _component, props) => {
                ctx.store.updateBlock(model, props);
                block.requestUpdate();
                const citationService = ctx.std.get(CitationProvider);
                if (citationService.isCitationModel(model)) {
                  citationService.trackEvent('Edit');
                }
              },
              abortController
            );

            ctx.track('OpenedAliasPopup', {
              category: 'linked doc',
              type: 'embed view',
              control: 'edit',
            });
          },
        },
      ],
    },
  ],
} as const satisfies ToolbarModuleConfig;

const embedSyncedDocToolbarConfig = {
  actions: [
    {
      placement: ActionPlacement.Start,
      id: 'B.copy-link-and-edit',
      actions: [
        {
          id: 'copy-link',
          tooltip: 'Copy link',
          icon: CopyIcon(),
          run(ctx) {
            const model = ctx.getCurrentModelByType(EmbedSyncedDocModel);
            if (!model) return;

            const { pageId, params } = model.props;

            const url = ctx.std
              .getOptional(GenerateDocUrlProvider)
              ?.generateDocUrl(pageId, params);

            if (!url) return;

            navigator.clipboard.writeText(url).catch(console.error);
            toast(ctx.host, 'Copied link to clipboard');

            ctx.track('CopiedLink', {
              category: 'linked doc',
              type: 'embed view',
              control: 'copy link',
            });
          },
        },
      ],
    },
  ],
} as const satisfies ToolbarModuleConfig;

const inlineReferenceToolbarConfig = {
  actions: [
    {
      id: 'b.copy-link-and-edit',
      actions: [
        {
          id: 'copy-link',
          tooltip: 'Copy link',
          icon: CopyIcon(),
          run(ctx) {
            const target = ctx.message$.peek()?.element;
            if (!(target instanceof NotesGraphReference)) return;

            const { pageId, params } = target.referenceInfo;

            const url = ctx.std
              .getOptional(GenerateDocUrlProvider)
              ?.generateDocUrl(pageId, params);

            if (!url) return;

            // Clears
            ctx.reset();

            navigator.clipboard.writeText(url).catch(console.error);
            toast(ctx.host, 'Copied link to clipboard');

            ctx.track('CopiedLink', {
              category: 'linked doc',
              type: 'inline view',
              control: 'copy link',
            });
          },
        },
        {
          id: 'edit',
          tooltip: 'Edit Description',
          icon: EditIcon(),
          run(ctx) {
            const target = ctx.message$.peek()?.element;
            if (!(target instanceof NotesGraphReference)) return;

            // Clears
            ctx.reset();

            const { inlineEditor, selfInlineRange, docTitle, referenceInfo } =
              target;
            if (!inlineEditor || !selfInlineRange) return;

            const abortController = new AbortController();
            const popover = toggleReferencePopup(
              ctx.std,
              docTitle,
              referenceInfo,
              inlineEditor,
              selfInlineRange,
              abortController
            );
            abortController.signal.onabort = () => popover.remove();

            ctx.track('OpenedAliasPopup', {
              category: 'linked doc',
              type: 'inline view',
              control: 'edit',
            });
          },
        },
      ],
    },
  ],
} as const satisfies ToolbarModuleConfig;

const embedIframeToolbarConfig = {
  when: (ctx: ToolbarContext) => {
    const model = ctx.getCurrentModelByType(EmbedIframeBlockModel);
    if (!model) return false;

    return !!model.props.url;
  },
  actions: [
    {
      id: 'b.copy-link',
      actions: [
        {
          id: 'copy-link',
          tooltip: 'Copy original link',
          icon: CopyIcon(),
          run(ctx) {
            const model = ctx.getCurrentBlockByType(
              EmbedIframeBlockComponent
            )?.model;
            if (!model) return;

            const { url } = model.props;

            navigator.clipboard.writeText(url).catch(console.error);
            toast(ctx.host, 'Copied link to clipboard');

            ctx.track('CopiedLink', {
              category: matchModels(model, [EmbedIframeBlockModel])
                ? 'embed iframe block'
                : 'link',
              type: 'card view',
              control: 'copy link',
            });
          },
        },
      ],
    },
    {
      id: 'c.edit',
      actions: [
        {
          id: 'edit',
          tooltip: 'Edit',
          icon: EditIcon(),
          run(ctx) {
            const block = ctx.getCurrentBlockByType(EmbedIframeBlockComponent);
            if (!block) return;

            ctx.hide();

            const model = block.model;
            const abortController = new AbortController();
            abortController.signal.onabort = () => ctx.show();

            toggleEmbedCardEditModal(
              ctx.host,
              model,
              'embed',
              undefined,
              undefined,
              (_std, _component, props) => {
                ctx.store.updateBlock(model, props);
                block.requestUpdate();
              },
              abortController
            );

            ctx.track('OpenedAliasPopup', {
              category: 'link',
              type: 'embed view',
              control: 'edit',
            });
          },
        },
      ],
    },
  ],
} as const satisfies ToolbarModuleConfig;

/**
 * Adds a "Screenshot view" to the embed (iframe) block's view dropdown
 * (`c.conversions`), so you can switch an embed straight to a screenshot card.
 * Merged positionally on top of the builtin [inline, card, embed] actions.
 */
function createIframeConversionsOverride(
  resolveImage: LinkCardImageResolver
): ToolbarActionGroup<ToolbarAction> {
  return {
    id: 'c.conversions',
    actions: [
      { id: 'inline' },
      // Override "Card view" so it converts to a big vertical card (the builtin
      // forces a compact horizontal style); no image/title so it auto-fetches
      // the clipper card, title and description.
      {
        id: 'card',
        run: (ctx: ToolbarContext) => {
          const model = ctx.getCurrentModelByType(EmbedIframeBlockModel);
          if (!model) return;
          const { url, caption } = model.props;
          if (!url) return;
          const { parent } = model;
          const index = parent?.children.indexOf(model);
          const blockId = ctx.store.addBlock(
            'notesgraph:bookmark',
            { url, caption, style: 'vertical' },
            parent,
            index
          );
          ctx.store.deleteBlock(model);
          ctx.select('note', [
            ctx.selection.create(BlockSelection, { blockId }),
          ]);
        },
      },
      { id: 'embed' },
      {
        id: 'screenshot',
        label: 'Screenshot view',
        run: (ctx: ToolbarContext) => {
          void (async () => {
            const model = ctx.getCurrentModelByType(EmbedIframeBlockModel);
            if (!model) return;
            const { url, caption, title } = model.props;
            if (!url) return;
            const { parent } = model;
            const index = parent?.children.indexOf(model);
            const props = await screenshotBookmarkProps(
              ctx,
              url,
              resolveImage,
              title ?? caption
            );
            const blockId = ctx.store.addBlock(
              'notesgraph:bookmark',
              { ...props, caption },
              parent,
              index
            );
            ctx.store.deleteBlock(model);
            ctx.select('note', [
              ctx.selection.create(BlockSelection, { blockId }),
            ]);
          })().catch(console.error);
        },
      },
    ],
  };
}

function createIframeToolbarConfig(resolveImage: LinkCardImageResolver) {
  return {
    ...embedIframeToolbarConfig,
    actions: [
      ...embedIframeToolbarConfig.actions,
      createIframeConversionsOverride(resolveImage),
    ],
  } satisfies ToolbarModuleConfig;
}

// --- Link-card display mode toggle: card (default) / screenshot / iframe ---
// Card & screenshot are rendered by the link-card host and shown as the
// bookmark image; iframe is a native notesgraph:embed-iframe.

function linkBlockLocation(
  ctx: ToolbarContext,
  model: BookmarkBlockModel | EmbedIframeBlockModel
) {
  const parent = ctx.store.getParent(model);
  if (!parent) return null;
  return { parent, index: parent.children.indexOf(model) };
}

// Resolves a bookmark image src for a mode; host-aware (sidecar URL on web,
// data URL via IPC on desktop). Supplied by `getEditorConfigExtension`.
export type LinkCardImageResolver = (
  url: string,
  mode: ClipMode
) => Promise<string>;

export type LinkCardEmbeddableChecker = (url: string) => Promise<boolean>;

// A non-empty title for a freshly created bookmark. Without one the bookmark
// auto-fetches its link preview on mount (bookmark-block.ts) and overwrites the
// screenshot `image` with the card. Falls back to the URL hostname.
function bookmarkTitle(
  url: string,
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value !== url) return value;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Props for a vertical screenshot bookmark. We set a title so the bookmark does
// not auto-fetch its preview (which would overwrite the screenshot with the
// card), so fetch the preview here to keep the real favicon / title / desc.
async function screenshotBookmarkProps(
  ctx: ToolbarContext,
  url: string,
  resolveImage: LinkCardImageResolver,
  fallbackTitle?: string | null
) {
  const [image, preview] = await Promise.all([
    resolveImage(url, 'screenshot'),
    ctx.std
      .get(LinkPreviewServiceIdentifier)
      .query(url)
      .catch(() => null),
  ]);
  return {
    url,
    title: bookmarkTitle(url, preview?.title, fallbackTitle),
    description: preview?.description ?? null,
    icon: preview?.icon ?? null,
    image,
    style: 'vertical' as const,
  };
}

/**
 * Override the bookmark's built-in "Inline / Card / Embed" view dropdown
 * (`b.conversions`) instead of adding separate buttons. Same-id toolbar actions
 * are deep-merged (lodash) positionally, and `custom:notesgraph:bookmark` is merged
 * on top of the builtin, so we:
 *   - keep "Inline view" (index 0) untouched,
 *   - make "Card view" (index 1) switch the image to the clipper card,
 *   - override "Embed view" (index 2) to fall back to a screenshot when the
 *     site refuses framing,
 *   - append a new "Screenshot view" (index 3).
 */
function createConversionsOverride(
  resolveImage: LinkCardImageResolver,
  checkEmbeddable: LinkCardEmbeddableChecker
): ToolbarActionGroup<ToolbarAction> {
  // `style` lets screenshot use the vertical layout (big image above the label).
  const setImage =
    (mode: ClipMode, style?: BookmarkBlockModel['props']['style']) =>
    (ctx: ToolbarContext) => {
      void (async () => {
        const model = ctx.getCurrentBlockByType(BookmarkBlockComponent)?.model;
        if (!model) return;
        const image = await resolveImage(model.props.url, mode);
        ctx.store.updateBlock(model, { image, ...(style ? { style } : {}) });
      })().catch(console.error);
    };

  return {
    id: 'b.conversions',
    actions: [
      // index 0: "Inline view" — keep the builtin behavior.
      { id: 'inline' },
      // index 1: "Card view" — enable it and (re)render the clipper card as a
      // big banner (same vertical layout as the screenshot).
      { id: 'card', disabled: false, run: setImage('card', 'vertical') },
      // index 2: "Embed view" — embed if framable, else screenshot fallback.
      {
        id: 'embed',
        run: (ctx: ToolbarContext) => {
          void (async () => {
            const model = ctx.getCurrentBlockByType(
              BookmarkBlockComponent
            )?.model;
            if (!model) return;
            const url = model.props.url;
            if (!(await checkEmbeddable(url))) {
              const image = await resolveImage(url, 'screenshot');
              // big screenshot above the label card
              ctx.store.updateBlock(model, { image, style: 'vertical' });
              notify({
                theme: 'warning',
                title: "This site can't be embedded",
                message:
                  'It blocks being shown in a frame, so a screenshot was added instead.',
              });
              return;
            }
            const loc = linkBlockLocation(ctx, model);
            if (!loc) return;
            ctx.store.addBlock(
              'notesgraph:embed-iframe',
              {
                url,
                title: model.props.title,
                description: model.props.description,
              },
              loc.parent,
              loc.index
            );
            ctx.store.deleteBlock(model);
          })().catch(console.error);
        },
      },
      // index 3: "Screenshot view" — big screenshot above the label card.
      {
        id: 'screenshot',
        label: 'Screenshot view',
        run: setImage('screenshot', 'vertical'),
      },
    ],
    // Override the dropdown rendering so the current view reflects the actual
    // state (screenshot vs card). Card & screenshot share the vertical layout,
    // so distinguish them by the image source (the web sidecar URL carries the
    // mode; desktop data URLs fall back to "Card view").
    content(ctx: ToolbarContext) {
      const model = ctx.getCurrentBlockByType(BookmarkBlockComponent)?.model;
      if (!model) return null;
      const actions = (this as ToolbarActionGroup<ToolbarAction>).actions.map(
        action => ({ ...action })
      );
      const viewTypeSignal = signal(
        (model.props.image ?? '').includes('mode=screenshot')
          ? 'Screenshot view'
          : 'Card view'
      );
      return html`${keyed(
        model,
        html`<notesgraph-view-dropdown-menu
          .actions=${actions}
          .context=${ctx}
          .viewTypeSignal=${viewTypeSignal}
        ></notesgraph-view-dropdown-menu>`
      )}`;
    },
  };
}

/**
 * "Import transcript" on video links (YouTube for now): fetches the
 * transcript via the link-card sidecar, materializes it as a searchable doc,
 * and drops a linked-doc card right below the video so the note becomes the
 * transcript's parent in the graph.
 */
function createImportTranscriptGroup(
  framework: FrameworkProvider,
  klass: typeof BookmarkBlockComponent | typeof EmbedYoutubeBlockComponent
): ToolbarModuleConfig['actions'][number] {
  return {
    id: 'a.import-transcript',
    when: ctx => {
      const model = ctx.getCurrentBlockByType(klass)?.model;
      const url = model?.props.url;
      return !!url && isYoutubeVideoUrl(url);
    },
    actions: [
      {
        id: 'import-transcript',
        tooltip: 'Import transcript',
        icon: CaptionIcon(),
        run(ctx) {
          const model = ctx.getCurrentBlockByType(klass)?.model;
          const url = model?.props.url;
          if (!model || !url) return;

          const videoIngestion = framework.get(VideoIngestionService);
          toast(ctx.host, 'Importing transcript…');
          videoIngestion
            .ingestYoutubeTranscript(url)
            .then(({ docId }) => {
              const { parent } = model;
              if (parent) {
                ctx.store.addBlock(
                  'notesgraph:embed-linked-doc',
                  { pageId: docId },
                  parent,
                  parent.children.indexOf(model) + 1
                );
              }
              toast(ctx.host, 'Transcript imported');
            })
            .catch((err: unknown) => {
              console.error(
                '[NG-DIAG video-ingestion] transcript import failed:',
                err
              );
              toast(
                ctx.host,
                err instanceof Error
                  ? err.message
                  : 'Could not import transcript'
              );
            });
        },
      },
    ],
  };
}

function createBookmarkLinkCardToolbarConfig(
  framework: FrameworkProvider,
  resolveImage: LinkCardImageResolver,
  checkEmbeddable: LinkCardEmbeddableChecker
) {
  const base = createExternalLinkableToolbarConfig(BookmarkBlockComponent);
  return {
    ...base,
    actions: [
      ...base.actions,
      createImportTranscriptGroup(framework, BookmarkBlockComponent),
      createConversionsOverride(resolveImage, checkEmbeddable),
    ],
  } satisfies ToolbarModuleConfig;
}

/**
 * Adds a "Screenshot view" option to the inline link's view dropdown
 * (`c.conversions`), so you can convert an inline link straight to a screenshot
 * card (not just from the bookmark/card view). Merged positionally on top of the
 * builtin [inline, card, embed] actions.
 */
function createInlineLinkConversionsOverride(
  resolveImage: LinkCardImageResolver,
  checkEmbeddable: LinkCardEmbeddableChecker
): ToolbarModuleConfig {
  // Convert the inline link to a screenshot bookmark (big image + label).
  const toScreenshotBookmark = async (
    ctx: ToolbarContext,
    target: NotesGraphLink,
    notifyFallback: boolean
  ) => {
    const url = target.link;
    if (!url || !target.block) return;
    const {
      block: { model },
      inlineEditor,
      selfInlineRange,
    } = target;
    const { parent } = model;
    if (!inlineEditor || !selfInlineRange || !parent) return;

    ctx.reset();
    const linkText = inlineEditor.yTextString.slice(
      selfInlineRange.index,
      selfInlineRange.index + selfInlineRange.length
    );
    const index = parent.children.indexOf(model);
    const props = await screenshotBookmarkProps(
      ctx,
      url,
      resolveImage,
      linkText
    );
    const blockId = ctx.store.addBlock(
      'notesgraph:bookmark',
      props,
      parent,
      index + 1
    );

    if (inlineEditor.yTextLength === selfInlineRange.length) {
      ctx.store.deleteBlock(model);
    } else {
      inlineEditor.formatText(selfInlineRange, { link: null });
    }
    ctx.select('note', [ctx.selection.create(BlockSelection, { blockId })]);
    if (notifyFallback) {
      notify({
        theme: 'warning',
        title: "This site can't be embedded",
        message:
          'It blocks being shown in a frame, so a screenshot was added instead.',
      });
    }
  };

  return {
    actions: [
      {
        id: 'c.conversions',
        actions: [
          { id: 'inline' },
          { id: 'card' },
          // Override "Embed view": embed if framable, else fall back to a
          // screenshot (the builtin runs straight to an iframe with no check).
          {
            id: 'embed',
            run: (ctx: ToolbarContext) => {
              void (async () => {
                const target = ctx.message$.peek()?.element;
                if (!(target instanceof NotesGraphLink) || !target.block)
                  return;
                const url = target.link;
                if (!url) return;
                const {
                  block: { model },
                  inlineEditor,
                  selfInlineRange,
                } = target;
                const { parent } = model;
                if (!inlineEditor || !selfInlineRange || !parent) return;

                const embedOptions = ctx.std
                  .get(EmbedOptionProvider)
                  .getEmbedBlockOptions(url);

                // Dedicated embeds (YouTube/Figma/…) always embed; generic URLs
                // fall back to a screenshot when they refuse framing.
                if (
                  embedOptions?.viewType !== 'embed' &&
                  !(await checkEmbeddable(url))
                ) {
                  await toScreenshotBookmark(ctx, target, true);
                  return;
                }

                ctx.reset();
                const index = parent.children.indexOf(model);
                let blockId: string | undefined;
                if (embedOptions?.viewType === 'embed') {
                  blockId = ctx.store.addBlock(
                    embedOptions.flavour,
                    { url },
                    parent,
                    index + 1
                  );
                } else {
                  blockId = ctx.std
                    .get(EmbedIframeService)
                    .addEmbedIframeBlock({ url }, parent.id, index + 1);
                }
                if (!blockId) return;

                if (inlineEditor.yTextLength === selfInlineRange.length) {
                  ctx.store.deleteBlock(model);
                } else {
                  inlineEditor.formatText(selfInlineRange, { link: null });
                }
                ctx.select('note', [
                  ctx.selection.create(BlockSelection, { blockId }),
                ]);
              })().catch(console.error);
            },
          },
          {
            id: 'screenshot',
            label: 'Screenshot view',
            run: (ctx: ToolbarContext) => {
              void (async () => {
                const target = ctx.message$.peek()?.element;
                if (!(target instanceof NotesGraphLink)) return;
                await toScreenshotBookmark(ctx, target, false);
              })().catch(console.error);
            },
          },
        ],
      },
    ],
  };
}

export const createCustomToolbarExtension = (
  framework: FrameworkProvider,
  settings: EditorSettingExt,
  baseUrl: string,
  resolveLinkCardImage: LinkCardImageResolver,
  checkLinkCardEmbeddable: LinkCardEmbeddableChecker
): ExtensionType[] => {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:*'),
      config: createToolbarMoreMenuConfigV2(baseUrl),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:bookmark'),
      config: createBookmarkLinkCardToolbarConfig(
        framework,
        resolveLinkCardImage,
        checkLinkCardEmbeddable
      ),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:link'),
      config: createInlineLinkConversionsOverride(
        resolveLinkCardImage,
        checkLinkCardEmbeddable
      ),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:bookmark'),
      config: createExternalLinkableToolbarConfig(BookmarkBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-figma'),
      config: createExternalLinkableToolbarConfig(EmbedFigmaBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-figma'),
      config: createExternalLinkableToolbarConfig(BookmarkBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-github'),
      config: createExternalLinkableToolbarConfig(EmbedGithubBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-github'),
      config: createExternalLinkableToolbarConfig(BookmarkBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-loom'),
      config: createExternalLinkableToolbarConfig(EmbedLoomBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-loom'),
      config: createExternalLinkableToolbarConfig(BookmarkBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-youtube'),
      config: (() => {
        const base = createExternalLinkableToolbarConfig(
          EmbedYoutubeBlockComponent
        );
        return {
          ...base,
          actions: [
            ...base.actions,
            createImportTranscriptGroup(framework, EmbedYoutubeBlockComponent),
          ],
        } satisfies ToolbarModuleConfig;
      })(),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-youtube'),
      config: createExternalLinkableToolbarConfig(BookmarkBlockComponent),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-linked-doc'),
      config: {
        actions: [
          embedLinkedDocToolbarConfig.actions,
          createOpenDocActionGroup(EmbedLinkedDocBlockComponent, settings),
        ].flat(),
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-linked-doc'),
      config: {
        actions: [
          embedLinkedDocToolbarConfig.actions,
          createOpenDocActionGroup(EmbedLinkedDocBlockComponent, settings),
          createEdgelessOpenDocActionGroup(EmbedLinkedDocBlockComponent),
        ].flat(),

        when: ctx => ctx.getSurfaceModels().length === 1,
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-synced-doc'),
      config: {
        actions: [
          embedSyncedDocToolbarConfig.actions,
          createOpenDocActionGroup(EmbedSyncedDocBlockComponent, settings),
        ].flat(),
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-synced-doc'),
      config: {
        actions: [
          // the open actions are provided by the header of embed-edgeless-synced-doc-block
          {
            id: 'A.open-doc',
            when: () => false,
          },
        ].flat(),
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:reference'),
      config: {
        actions: [
          {
            placement: ActionPlacement.Start,
            id: 'A.open-doc',
            content(ctx) {
              const target = ctx.message$.peek()?.element;
              if (!(target instanceof NotesGraphReference)) return null;

              return renderOpenDocMenu(
                settings,
                ctx,
                target,
                target.referenceInfo.pageId === ctx.store.id
              );
            },
          } as const satisfies ToolbarAction,
          inlineReferenceToolbarConfig.actions,
        ].flat(),
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:embed-iframe'),
      config: createIframeToolbarConfig(resolveLinkCardImage),
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:notesgraph:surface:embed-iframe'),
      config: {
        actions: [embedIframeToolbarConfig.actions].flat(),

        when: ctx => ctx.getSurfaceModels().length === 1,
      },
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier(
        `custom:${SurfaceRefBlockSchema.model.flavour}`
      ),
      config: createSurfaceRefToolbarConfig(baseUrl),
    }),
  ];
};
