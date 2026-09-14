import {
  createRecordDetail,
  createUniComponentFromWebComponent,
  DataViewRootUILogic,
  type DataViewSelection,
  type DataViewUILogicBase,
  type DataViewWidget,
  type DataViewWidgetProps,
  defineUniComponent,
  ExternalGroupByConfigProvider,
  lazy,
  renderUniLit,
  type SingleView,
  uniMap,
} from '@blocksuite/data-view';
import { CalendarExternalSourceProvider } from '@blocksuite/data-view/view-presets';
import { widgetPresets } from '@blocksuite/data-view/widget-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { Rect } from '@blocksuite/global/gfx';
import {
  CommentIcon,
  CopyIcon,
  DeleteIcon,
  FilterIcon,
  MoreHorizontalIcon,
} from '@blocksuite/icons/lit';
import { CaptionedBlockComponent } from '@blocksuite/notesgraph-components/caption';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import { DropIndicator } from '@blocksuite/notesgraph-components/drop-indicator';
import { PeekViewProvider } from '@blocksuite/notesgraph-components/peek';
import { toast } from '@blocksuite/notesgraph-components/toast';
import type { DatabaseBlockModel } from '@blocksuite/notesgraph-model';
import { EDGELESS_TOP_CONTENTEDITABLE_SELECTOR } from '@blocksuite/notesgraph-shared/consts';
import {
  BlockElementCommentManager,
  BlockTaskIndexProvider,
  CommentProviderIdentifier,
  DocModeProvider,
  FeatureFlagService,
  ProjectsProvider,
  NotificationProvider,
  type TelemetryEventMap,
  TelemetryProvider,
} from '@blocksuite/notesgraph-shared/services';
import {
  createDefaultDoc,
  ORG_STATUS_CANONICAL,
} from '@blocksuite/notesgraph-shared/utils';
import { getDropResult } from '@blocksuite/notesgraph-widget-drag-handle';
import { type BlockComponent, BlockSelection } from '@blocksuite/std';
import { RANGE_SYNC_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import { Slice } from '@blocksuite/store';
import { autoUpdate } from '@floating-ui/dom';
import { computed, signal } from '@preact/signals-core';
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { popSideDetail } from './components/layout.js';
import { DatabaseConfigExtension } from './config.js';
import { EditorHostKey } from './context/host-context.js';
import { DatabaseBlockDataSource } from './data-source.js';
import { MirrorListDataSource } from './mirror-data-source.js';
import {
  parseQueryTokens,
  QueryListDataSource,
  queryTokensString,
} from './query-data-source.js';
import {
  databaseBlockStyles,
  databaseContentListStyles,
  databaseContentStyles,
  databaseHeaderBarStyles,
  databaseHeaderContainerStyles,
  databaseOpsStyles,
  databaseTitleRowStyles,
  databaseTitleStyles,
  databaseToolbarRowStyles,
  databaseViewBarContainerStyles,
  dbCollapsedHeaderStyles,
  dbCollapsedTitleStyles,
  dbCollapseToggleStyles,
  queryScopeBarStyles,
  queryScopeChipStyles,
  queryScopeEditStyles,
} from './database-block-styles.js';
import { BlockRenderer } from './detail-panel/block-renderer.js';
import { NoteRenderer } from './detail-panel/note-renderer.js';
import { DatabaseSelection } from './selection.js';
import { currentViewStorage } from './utils/current-view.js';
import { getSingleDocIdFromText } from './utils/title-doc.js';
import type { DatabaseViewExtensionOptions } from './view';

export class DatabaseBlockComponent extends CaptionedBlockComponent<DatabaseBlockModel> {
  private readonly clickDatabaseOps = (e: MouseEvent) => {
    const options = this.optionsConfig.configure(this.model, {
      items: [
        menu.input({
          initialValue: this.model.props.title.toString(),
          placeholder: 'Database title',
          onChange: text => {
            this.model.props.title.replace(
              0,
              this.model.props.title.length,
              text
            );
          },
        }),
        menu.action({
          prefix: CommentIcon(),
          name: 'Comment',
          hide: () => !this.std.getOptional(CommentProviderIdentifier),
          select: () => {
            this.std.getOptional(CommentProviderIdentifier)?.addComment([
              new BlockSelection({
                blockId: this.blockId,
              }),
            ]);
          },
        }),
        menu.action({
          prefix: CopyIcon(),
          name: 'Copy',
          select: () => {
            const slice = Slice.fromModels(this.store, [this.model]);
            this.std.clipboard
              .copySlice(slice)
              .then(() => {
                toast(this.host, 'Copied to clipboard');
              })
              .catch(console.error);
          },
        }),
        menu.group({
          items: [
            menu.action({
              prefix: DeleteIcon(),
              class: {
                'delete-item': true,
              },
              name: 'Delete Database',
              select: () => {
                this.model.children.slice().forEach(block => {
                  this.store.deleteBlock(block);
                });
                this.store.deleteBlock(this.model);
              },
            }),
          ],
        }),
      ],
    });

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options,
    });
  };

  private readonly dataSource = lazy(() => {
    const DataSourceCtor = this.model.props.mirrorBlockId
      ? MirrorListDataSource
      : this.model.props.queryTags || this.model.props.queryProps
        ? QueryListDataSource
        : DatabaseBlockDataSource;
    const dataSource = new DataSourceCtor(this.model, dataSource => {
      dataSource.serviceSet(EditorHostKey, this.host);
      // Query boards resolve their rows through the app's block index,
      // registered at the view level — pass it through to the data source's
      // own container.
      const taskIndex = this.std.getOptional(BlockTaskIndexProvider);
      if (taskIndex) {
        dataSource.serviceSet(BlockTaskIndexProvider, taskIndex);
      }
      // Project-scoped task lists resolve their project's docs through this.
      const projects = this.std.getOptional(ProjectsProvider);
      if (projects) {
        dataSource.serviceSet(ProjectsProvider, projects);
      }
      this.std.provider
        .getAll(ExternalGroupByConfigProvider)
        .forEach(config => {
          dataSource.serviceSet(
            ExternalGroupByConfigProvider(config.name),
            config
          );
        });
      this.std.provider
        .getAll(CalendarExternalSourceProvider)
        .forEach(source => {
          dataSource.serviceSet(
            CalendarExternalSourceProvider(source.id),
            source
          );
        });
    });
    const id = currentViewStorage.getCurrentView(this.model.id);
    if (id && dataSource.viewManager.viewGet(id)) {
      dataSource.viewManager.setCurrentView(id);
    }
    return dataSource;
  });

  /** True when this database's rows come from a workspace-wide query. */
  private get isQueryDatabase(): boolean {
    return !!(this.model.props.queryTags || this.model.props.queryProps);
  }

  /**
   * The query scope editor: one tokens field (`#tag #key:value`), a status
   * single-select, and a "due within days" bound — writing straight to the
   * block's query props; the data source re-runs the index query live.
   */
  private readonly clickEditQueryScope = (e: MouseEvent) => {
    const props = this.model.props;
    const currentStatuses = () => props.queryStatus ?? [];
    const statusItems = ['Any', ...ORG_STATUS_CANONICAL.map(s => s.label)].map(
      label =>
        menu.action({
          name: label === 'Any' ? 'Any status' : label,
          isSelected:
            label === 'Any'
              ? currentStatuses().length === 0
              : currentStatuses().includes(label),
          select: () => {
            this.store.captureSync();
            props.queryStatus = label === 'Any' ? [] : [label];
          },
        })
    );

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.group({
            items: [
              menu.input({
                initialValue: queryTokensString({
                  tags: props.queryTags,
                  props: props.queryProps,
                }),
                placeholder: '#tags #key:value (empty = all tasks)',
                onComplete: value => {
                  const parsed = parseQueryTokens(value);
                  this.store.captureSync();
                  props.queryTags = parsed.tags;
                  props.queryProps = parsed.props;
                },
              }),
            ],
          }),
          menu.group({ items: statusItems }),
          menu.group({
            items: [
              menu.input({
                initialValue:
                  typeof props.queryDueInDays === 'number'
                    ? String(props.queryDueInDays)
                    : '',
                placeholder: 'Due within days (empty = off)',
                onComplete: value => {
                  const days = Number.parseInt(value.trim(), 10);
                  this.store.captureSync();
                  props.queryDueInDays = Number.isFinite(days) ? days : null;
                },
              }),
            ],
          }),
        ],
      },
    });
  };

  private renderQueryScopeBar() {
    if (!this.isQueryDatabase) return nothing;
    const tags = this.model.props.queryTags$.value ?? [];
    const queryProps = this.model.props.queryProps$.value ?? [];
    const statuses = this.model.props.queryStatus$.value ?? [];
    const due = this.model.props.queryDueInDays$.value;
    const chips = [
      ...tags.map(tag => `#${tag}`),
      ...queryProps.map(prop => `#${prop}`),
      ...statuses.map(status => `status: ${status}`),
      ...(typeof due === 'number' ? [`due ≤ ${due}d`] : []),
    ];
    return html`<div
      class="${queryScopeBarStyles}"
      contenteditable="false"
      data-testid="query-scope-bar"
    >
      <span>Query:</span>
      ${chips.length
        ? chips.map(
            chip => html`<span class="${queryScopeChipStyles}">${chip}</span>`
          )
        : html`<span class="${queryScopeChipStyles}">all tasks</span>`}
      ${this.dataSource.value.readonly$.value
        ? nothing
        : html`<span
            class="${queryScopeEditStyles}"
            data-testid="query-scope-edit"
            @click="${this.clickEditQueryScope}"
            >${FilterIcon()} Edit</span
          >`}
    </div>`;
  }

  /**
   * Query boards (the journal's per-project "todos:" Task Lists) start
   * collapsed: a journal carries one per project plus an Inbox, and expanded
   * they bury the day's own writing under screens of task rows. `collapsed`
   * is undefined until the reader actually toggles it, so defaulting on that
   * applies to journals that already exist rather than only new ones — and
   * an explicit expand (which writes `false`) still sticks.
   */
  private get collapsedByDefault(): boolean {
    const props = this.model.props;
    return !!(props.queryProjectId$.value || props.queryNoProject$.value);
  }

  private get isCollapsed(): boolean {
    return this.model.props.collapsed$.value ?? this.collapsedByDefault;
  }

  private readonly toggleCollapsed = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    this.store.captureSync();
    this.model.props.collapsed = !this.isCollapsed;
  };

  private renderCollapseToggle() {
    const collapsed = this.isCollapsed;
    return html`<span
      class="${dbCollapseToggleStyles}"
      contenteditable="false"
      data-testid="database-collapse-toggle"
      @click=${this.toggleCollapsed}
      >${collapsed ? '▸' : '▾'}</span
    >`;
  }

  private readonly renderTitle = (dataViewLogic: DataViewUILogicBase) => {
    return html` <notesgraph-database-title
      class="${databaseTitleStyles}"
      .titleText="${this.model.props.title}"
      .dataViewLogic="${dataViewLogic}"
    ></notesgraph-database-title>`;
  };

  createTemplate = (
    data: {
      view: SingleView;
      rowId: string;
    },
    openDoc: (docId: string) => void
  ) => {
    return createRecordDetail({
      ...data,
      openDoc,
      detail: {
        header: uniMap(
          createUniComponentFromWebComponent(BlockRenderer),
          props => ({
            ...props,
            host: this.host,
          })
        ),
        note: uniMap(
          createUniComponentFromWebComponent(NoteRenderer),
          props => ({
            ...props,
            model: this.model,
            host: this.host,
          })
        ),
      },
    });
  };

  headerWidget: DataViewWidget = defineUniComponent(
    (props: DataViewWidgetProps) => {
      return html`
        <div class="${databaseHeaderContainerStyles}">
          <div class="${databaseTitleRowStyles}">
            ${this.renderCollapseToggle()}
            ${this.renderTitle(props.dataViewLogic)} ${this.renderDatabaseOps()}
          </div>
          ${this.renderQueryScopeBar()}
          <div class="${databaseToolbarRowStyles} ${databaseHeaderBarStyles}">
            <div class="${databaseViewBarContainerStyles}">
              ${renderUniLit(widgetPresets.viewBar, {
                ...props,
                onChangeView: id => {
                  currentViewStorage.setCurrentView(this.blockId, id);
                },
              })}
            </div>
            ${renderUniLit(this.toolsWidget, props)}
          </div>
          ${renderUniLit(widgetPresets.quickSettingBar, props)}
        </div>
      `;
    }
  );

  indicator = new DropIndicator();

  onDrag = (evt: MouseEvent, id: string): (() => void) => {
    const result = getDropResult(evt);
    if (result && result.rect) {
      document.body.append(this.indicator);
      this.indicator.rect = Rect.fromLWTH(
        result.rect.left,
        result.rect.width,
        result.rect.top,
        result.rect.height
      );
      return () => {
        this.indicator.remove();
        const model = this.store.getBlock(id)?.model;
        const target = result.modelState.model;
        let parent = this.store.getParent(target.id);
        const shouldInsertIn = result.placement === 'in';
        if (shouldInsertIn) {
          parent = target;
        }
        if (model && target && parent) {
          if (shouldInsertIn) {
            this.store.moveBlocks([model], parent);
          } else {
            this.store.moveBlocks(
              [model],
              parent,
              target,
              result.placement === 'before'
            );
          }
        }
      };
    }
    this.indicator.remove();
    return () => {};
  };

  private readonly setSelection = (
    selection: DataViewSelection | undefined
  ) => {
    if (selection) {
      getSelection()?.removeAllRanges();
    }
    this.selection.setGroup(
      'note',
      selection
        ? [
            new DatabaseSelection({
              blockId: this.blockId,
              viewSelection: selection,
            }),
          ]
        : []
    );
  };

  private readonly toolsWidget: DataViewWidget = widgetPresets.createTools({
    table: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    kanban: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    calendar: [
      widgetPresets.tools.filter,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    // A query list is read-only (no add-row) but keeps the generic filter/
    // sort/search bar so the query stays fully editable.
    list: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
    ],
  });

  private readonly viewSelection$ = computed(() => {
    const databaseSelection = this.selection.value.find(
      (selection): selection is DatabaseSelection => {
        if (selection.blockId !== this.blockId) {
          return false;
        }
        return selection instanceof DatabaseSelection;
      }
    );
    return databaseSelection?.viewSelection;
  });

  private readonly virtualPadding$ = signal(0);

  get optionsConfig(): DatabaseViewExtensionOptions {
    return {
      configure: (_model, options) => options,
      ...this.std.getOptional(DatabaseConfigExtension.identifier),
    };
  }

  get isCommentHighlighted() {
    return (
      this.std
        .getOptional(BlockElementCommentManager)
        ?.isBlockCommentHighlighted(this.model) ?? false
    );
  }

  override get topContenteditableElement() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return this.closest<BlockComponent>(
        EDGELESS_TOP_CONTENTEDITABLE_SELECTOR
      );
    }
    return this.rootComponent;
  }

  private renderDatabaseOps() {
    if (this.dataSource.value.readonly$.value) {
      return nothing;
    }
    return html` <div
      data-testid="database-ops"
      class="${databaseOpsStyles}"
      @click="${this.clickDatabaseOps}"
    >
      ${MoreHorizontalIcon()}
    </div>`;
  }

  override connectedCallback() {
    super.connectedCallback();

    this.setAttribute(RANGE_SYNC_EXCLUDE_ATTR, 'true');
    this.classList.add(databaseBlockStyles);
    this.listenFullWidthChange();
    this.handleMobileEditing();
  }

  listenFullWidthChange() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return;
    }
    this.disposables.add(
      autoUpdate(this.host, this, () => {
        const padding =
          this.getBoundingClientRect().left -
          this.host.getBoundingClientRect().left;
        this.virtualPadding$.value = Math.max(0, padding - 72);
      })
    );
  }

  handleMobileEditing() {
    if (!IS_MOBILE) return;

    let notifyClosed = true;
    const handler = () => {
      if (
        !this.std
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing')
      ) {
        const notification = this.std.getOptional(NotificationProvider);
        if (notification && notifyClosed) {
          notifyClosed = false;
          notification.notify({
            title: html`<div
              style=${styleMap({
                whiteSpace: 'wrap',
              })}
            >
              Mobile database editing is not supported yet. You can open it in
              experimental features, or edit it in desktop mode.
            </div>`,
            accent: 'warning',
            onClose: () => {
              notifyClosed = true;
            },
          });
        }
      }
    };

    this.disposables.addFromEvent(this, 'click', handler);
  }

  private readonly dataViewRootLogic = lazy(
    () =>
      new DataViewRootUILogic({
        virtualPadding$: this.virtualPadding$,
        bindHotkey: hotkeys => {
          return {
            dispose: this.host.event.bindHotkey(hotkeys, {
              blockId: this.topContenteditableElement?.blockId ?? this.blockId,
            }),
          };
        },
        handleEvent: (name, handler) => {
          return {
            dispose: this.host.event.add(name, handler, {
              blockId: this.blockId,
            }),
          };
        },
        selection$: this.viewSelection$,
        setSelection: this.setSelection,
        dataSource: this.dataSource.value,
        headerWidget: this.headerWidget,
        onDrag: this.onDrag,
        clipboard: this.std.clipboard,
        dnd: this.std.dnd,
        notification: {
          toast: message => {
            const notification = this.std.getOptional(NotificationProvider);
            if (notification) {
              notification.toast(message);
            } else {
              toast(this.host, message);
            }
          },
        },
        eventTrace: (key, params) => {
          const telemetryService = this.std.getOptional(TelemetryProvider);
          telemetryService?.track(key, {
            ...(params as TelemetryEventMap[typeof key]),
            blockId: this.blockId,
          });
        },
        detailPanelConfig: {
          openDetailPanel: (target, data) => {
            const peekViewService = this.std.getOptional(PeekViewProvider);
            if (peekViewService) {
              const openDoc = (docId: string) => {
                return peekViewService.peek({
                  docId,
                  databaseId: this.blockId,
                  databaseDocId: this.model.store.id,
                  databaseRowId: data.rowId,
                  target: this,
                });
              };
              const doc = getSingleDocIdFromText(
                this.model.store.getBlock(data.rowId)?.model?.text
              );
              if (doc) {
                // The referenced doc may be missing (e.g. orphaned by a partial
                // import). Recreate it under its original id so the record opens
                // an editable doc instead of a dead "not found" reference.
                const workspace = this.model.store.workspace;
                if (!workspace.getDoc(doc)) {
                  createDefaultDoc(workspace, { id: doc });
                }
                return openDoc(doc);
              }
              const abort = new AbortController();
              return new Promise<void>(focusBack => {
                peekViewService
                  .peek(
                    {
                      target,
                      template: this.createTemplate(data, docId => {
                        // abort.abort();
                        openDoc(docId).then(focusBack).catch(focusBack);
                      }),
                    },
                    { abortSignal: abort.signal }
                  )
                  .then(focusBack)
                  .catch(focusBack);
              });
            } else {
              return popSideDetail(
                this.createTemplate(data, () => {
                  //
                })
              );
            }
          },
        },
      })
  );
  // The list ("Task List") view gets a distinguishing card background; other
  // view types keep the plain content styling.
  private get contentClass() {
    const isList =
      this.dataSource.value.viewManager.currentView$.value?.type === 'list';
    return isList
      ? `${databaseContentStyles} ${databaseContentListStyles}`
      : databaseContentStyles;
  }

  /**
   * Same styling decision as {@link contentClass}, but read off the model
   * instead of the data source.
   *
   * `dataSource` is lazy, and constructing a query board's source subscribes
   * to the workspace-wide task query and starts resolving hits — loading docs
   * this device hasn't opened. Asking it for the view type while collapsed
   * meant a board that renders nothing but a chevron still did all of that
   * work, which is a stall a few seconds after load with nothing on screen
   * to explain it. The view's `mode` is on the block model, so the collapsed
   * header never has to wake the source.
   */
  private get collapsedContentClass() {
    const isList = this.model.props.views$.value.some(
      view => view.mode === 'list'
    );
    return isList
      ? `${databaseContentStyles} ${databaseContentListStyles}`
      : databaseContentStyles;
  }

  override renderBlock() {
    // Collapsed like a toggle block: show only a chevron + the title, and skip
    // rendering the data view entirely (tools, view bar and rows all hidden).
    if (this.isCollapsed) {
      return html`
        <div contenteditable="false" class="${this.collapsedContentClass}">
          <div class="${dbCollapsedHeaderStyles}">
            ${this.renderCollapseToggle()}
            <span class="${dbCollapsedTitleStyles}"
              >${this.model.props.title.toString() || 'Untitled'}</span
            >
          </div>
        </div>
      `;
    }

    const widgets = html`${repeat(
      Object.entries(this.widgets),
      ([id]) => id,
      ([_, widget]) => widget
    )}`;

    return html`
      <div contenteditable="false" class="${this.contentClass}">
        ${this.dataViewRootLogic.value.render()} ${widgets}
      </div>
    `;
  }

  override accessor useZeroWidth = true;
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-database': DatabaseBlockComponent;
  }
}
