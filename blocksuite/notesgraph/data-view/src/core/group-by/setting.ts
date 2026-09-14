import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import {
  DeleteIcon,
  InvisibleIcon,
  MoreHorizontalIcon,
  ViewIcon,
} from '@blocksuite/icons/lit';
import {
  dropdownSubMenuMiddleware,
  menu,
  type MenuConfig,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import {
  inferLaneRole,
  LANE_ROLES,
  type LaneRole,
} from '@blocksuite/notesgraph-shared/utils';
import { ShadowlessElement } from '@blocksuite/std';
import { nanoid } from '@blocksuite/store';
import { computed } from '@preact/signals-core';
import { cssVarV2 } from '@toeverything/theme/v2';
import { css, html, unsafeCSS } from 'lit';
import { property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { canGroupable } from '../../view-presets/kanban/group-by-utils.js';
import { KanbanSingleView } from '../../view-presets/kanban/kanban-view-manager.js';
import { TableSingleView } from '../../view-presets/table/table-view-manager.js';
import { dataViewCssVariable } from '../common/css-variable.js';
import { getTagColor } from '../component/tags/colors.js';
import type { SelectTag } from '../logical/type-presets.js';
import { renderUniLit } from '../utils/uni-component/uni-component.js';
import { dragHandler } from '../utils/wc-dnd/dnd-context.js';
import { defaultActivators } from '../utils/wc-dnd/sensors/index.js';
import {
  createSortContext,
  sortable,
} from '../utils/wc-dnd/sort/sort-context.js';
import { verticalListSortingStrategy } from '../utils/wc-dnd/sort/strategies/index.js';
import { getGroupByService } from './matcher.js';
import type { GroupTrait } from './trait.js';
import type { GroupRenderProps } from './types.js';

const dateModeLabel = (key?: string) => {
  switch (key) {
    case 'date-relative':
      return 'Relative';
    case 'date-day':
      return 'Day';
    case 'date-week-mon':
    case 'date-week-sun':
      return 'Week';
    case 'date-month':
      return 'Month';
    case 'date-year':
      return 'Year';
    default:
      return '';
  }
};

export class GroupSetting extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    data-view-group-setting {
      display: flex;
      flex-direction: column;
      gap: 4px;
      ${unsafeCSS(dataViewCssVariable())};
    }

    .group-sort-setting {
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 1;
      max-height: 200px;
      overflow: hidden auto;
      margin-right: 0;
      margin-bottom: 0;
    }

    /* WebKit-based browser scrollbar styling */
    .group-sort-setting::-webkit-scrollbar {
      width: 8px;
    }

    .group-sort-setting::-webkit-scrollbar-thumb {
      background-color: #b0b0b0; /* Grey slider */
      border-radius: 4px;
    }

    .group-sort-setting::-webkit-scrollbar-track {
      background: transparent;
    }

    .group-sort-setting {
      scrollbar-width: thin;
      scrollbar-color: #b0b0b0 transparent;
    }
    .group-hidden {
      opacity: 0.5;
    }
    .group-item {
      display: flex;
      padding: 4px 12px;
      position: relative;
      cursor: grab;
    }
    .group-item-drag-bar {
      width: 4px;
      height: 12px;
      border-radius: 1px;
      background-color: #efeff0;
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      margin: auto;
    }
    .group-item:hover .group-item-drag-bar {
      background-color: #c0bfc1;
    }
    .group-item-op-icon {
      display: flex;
      align-items: center;
      border-radius: 4px;
    }
    .group-item-op-icon:hover {
      background-color: var(--notesgraph-hover-color);
    }
    .group-item-op-icon svg {
      fill: var(--notesgraph-icon-color);
      color: var(--notesgraph-icon-color);
      width: 20px;
      height: 20px;
    }

    .group-item-name {
      font-size: 14px;
      line-height: 22px;
      flex: 1;
    }

    .properties-group-op {
      padding: 4px 8px;
      font-size: 12px;
      line-height: 20px;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      color: ${unsafeCSS(cssVarV2.button.primary)};
    }

    .properties-group-op:hover {
      background-color: var(--notesgraph-hover-color);
    }

    .lane-role-chip {
      align-self: center;
      margin-right: 4px;
      padding: 0 6px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 18px;
      white-space: nowrap;
      cursor: pointer;
      color: var(--notesgraph-text-secondary-color);
      background-color: var(--notesgraph-hover-color);
    }

    .lane-add-input {
      margin: 4px 12px 8px;
      padding: 4px 8px;
      border: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
      border-radius: 4px;
      font-size: 13px;
      background: transparent;
      color: var(--notesgraph-text-primary-color);
      outline: none;
    }
  `;

  @property({ attribute: false })
  accessor groupTrait!: GroupTrait;

  groups$ = computed(() => this.groupTrait.groupsDataListAll$.value);

  sortContext = createSortContext({
    activators: defaultActivators,
    container: this,
    onDragEnd: evt => {
      const over = evt.over;
      const activeId = evt.active.id;
      const groups = this.groups$.value;
      if (over && over.id !== activeId && groups) {
        const aIndex = groups.findIndex(g => g?.key === activeId);
        const oIndex = groups.findIndex(g => g?.key === over.id);
        this.groupTrait.moveGroupTo(
          activeId,
          aIndex > oIndex
            ? { before: true, id: over.id }
            : { before: false, id: over.id }
        );
        queueMicrotask(() => this.syncLaneDeclaration());
      }
    },
    modifiers: [({ transform }) => ({ ...transform, x: 0 })],
    items: computed(
      () =>
        this.groupTrait.groupsDataListAll$.value?.map(v => v?.key ?? '') ?? []
    ),
    strategy: verticalListSortingStrategy,
  });

  override connectedCallback() {
    super.connectedCallback();
    this._disposables.addFromEvent(this, 'pointerdown', e =>
      e.stopPropagation()
    );
  }

  /**
   * When the board groups by a select property, its options ARE the lanes —
   * the panel then offers per-lane roles (start/progress/blocked/done),
   * adding and deleting lanes, and mirrors the lane set into the doc's
   * plain-text `#+SEQ_TODO:` declaration (org-task boards only).
   */
  private laneProperty() {
    const groups = this.groupTrait.groupsDataListAll$.value;
    const property = groups?.find(g => g)?.property;
    if (!property) return null;
    const data = property.data$.value as { options?: SelectTag[] };
    return Array.isArray(data?.options) ? { property, options: data.options } : null;
  }

  private updateLaneOptions(
    property: NonNullable<ReturnType<GroupSetting['laneProperty']>>['property'],
    options: SelectTag[]
  ) {
    property.dataUpdate(data => ({ ...(data as object), options }) as never);
    // Mirror into the doc's plain-text declaration after the data settles.
    queueMicrotask(() => this.syncLaneDeclaration());
  }

  private laneRoleOf(option: SelectTag): LaneRole {
    return option.role ?? inferLaneRole(option.value);
  }

  syncLaneDeclaration() {
    const lane = this.laneProperty();
    if (!lane) return;
    const dataSource = (
      this.groupTrait as unknown as {
        view?: { manager?: { dataSource?: unknown } };
      }
    ).view?.manager?.dataSource as
      | {
          writeLaneDeclaration?: (
            lanes: { value: string; role: LaneRole }[]
          ) => void;
        }
      | undefined;
    if (!dataSource?.writeLaneDeclaration) return;
    const groups = this.groupTrait.groupsDataListAll$.value ?? [];
    const lanes = groups
      .filter(g => g && !g.hide$.value)
      .map(g => lane.options.find(o => o.id === g!.key))
      .filter((o): o is SelectTag => !!o)
      .map(o => ({ value: o.value, role: this.laneRoleOf(o) }));
    dataSource.writeLaneDeclaration(lanes);
  }

  private clickLaneMenu(e: MouseEvent, optionId: string) {
    e.stopPropagation();
    const lane = this.laneProperty();
    if (!lane) return;
    const option = lane.options.find(o => o.id === optionId);
    if (!option) return;
    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.group({
            name: 'Lane role',
            items: LANE_ROLES.map(({ role, label }) =>
              menu.action({
                name: label,
                isSelected: this.laneRoleOf(option) === role,
                select: () => {
                  this.updateLaneOptions(
                    lane.property,
                    lane.options.map(o =>
                      o.id === optionId ? { ...o, role } : o
                    )
                  );
                },
              })
            ),
          }),
          menu.group({
            name: '',
            items: [
              menu.action({
                name: 'Delete Lane',
                class: { 'delete-item': true },
                prefix: DeleteIcon(),
                select: () => {
                  this.updateLaneOptions(
                    lane.property,
                    lane.options.filter(o => o.id !== optionId)
                  );
                },
              }),
            ],
          }),
        ],
      },
    });
  }

  private addLane(name: string) {
    const lane = this.laneProperty();
    const value = name.trim();
    if (!lane || !value) return;
    if (lane.options.some(o => o.value.toLowerCase() === value.toLowerCase()))
      return;
    this.updateLaneOptions(lane.property, [
      ...lane.options,
      { id: nanoid(), value, color: getTagColor() },
    ]);
  }

  protected override render() {
    const groups = this.groupTrait.groupsDataListAll$.value;
    if (!groups) return;
    const map = this.groupTrait.groupDataMap$.value;
    const isAllShowed = map
      ? Object.keys(map).every(k => !this.groupTrait.isGroupHidden(k))
      : true;
    const clickChangeAll = () => {
      if (!map) return;
      Object.keys(map).forEach(key => {
        this.groupTrait.setGroupHide(key, isAllShowed);
      });
    };
    return html`
      <div
        style="padding:7px 0;display:flex;justify-content:space-between;align-items:center;"
      >
        <div
          style="padding:0 4px;font-size:12px;color:var(--notesgraph-text-secondary-color);line-height:20px;"
        >
          Groups
        </div>
        <div class="properties-group-op" @click="${clickChangeAll}">
          ${isAllShowed ? 'Hide All' : 'Show All'}
        </div>
      </div>

      <div class="group-sort-setting">
        ${repeat(
          groups,
          g => g?.key ?? 'k',
          g => {
            if (!g) return;
            const type = g.property.dataType$.value;
            if (!type) return;
            const props: GroupRenderProps = { group: g, readonly: true };
            const icon = g.hide$.value ? InvisibleIcon() : ViewIcon();
            const lane = this.laneProperty();
            const option = lane?.options.find(o => o.id === g.key);
            const role = option ? this.laneRoleOf(option) : null;
            const roleLabel = role
              ? LANE_ROLES.find(r => r.role === role)?.label
              : null;
            return html`
              <div
                ${sortable(g.key)}
                ${dragHandler(g.key)}
                class="dv-hover dv-round-4 group-item ${g.hide$.value
                  ? 'group-hidden'
                  : ''}"
              >
                <div class="group-item-drag-bar"></div>
                <div
                  class="group-item-name"
                  style="padding:0 4px;position:relative;pointer-events:none;max-width:330px;"
                >
                  ${renderUniLit(g.view, props)}
                  <div
                    style="position:absolute;left:0;top:0;right:0;bottom:0;"
                  ></div>
                </div>
                ${roleLabel
                  ? html`<div
                      class="lane-role-chip"
                      @click="${(e: MouseEvent) =>
                        this.clickLaneMenu(e, g.key)}"
                    >
                      ${roleLabel}
                    </div>`
                  : ''}
                <div
                  class="group-item-op-icon"
                  @click="${() => {
                    g.hideSet(!g.hide$.value);
                    queueMicrotask(() => this.syncLaneDeclaration());
                  }}"
                >
                  ${icon}
                </div>
                ${option
                  ? html`<div
                      class="group-item-op-icon"
                      @click="${(e: MouseEvent) =>
                        this.clickLaneMenu(e, g.key)}"
                    >
                      ${MoreHorizontalIcon()}
                    </div>`
                  : ''}
              </div>
            `;
          }
        )}
      </div>
      ${this.laneProperty()
        ? html`<input
            class="lane-add-input"
            placeholder="Add lane…"
            @pointerdown="${(e: Event) => e.stopPropagation()}"
            @keydown="${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                const input = e.currentTarget as HTMLInputElement;
                this.addLane(input.value);
                input.value = '';
              }
              e.stopPropagation();
            }}"
          />`
        : ''}
    `;
  }

  @query('.group-sort-setting') accessor groupContainer!: HTMLElement;
}

export const buildGroupSelectItems = (
  group: GroupTrait,
  onSelect: (id?: string) => void
): MenuConfig[] => {
  const view = group.view;
  return [
    menu.group({
      items: view.propertiesRaw$.value
        .filter(property => {
          if (property.type$.value === 'title') {
            return false;
          }
          if (view instanceof KanbanSingleView) {
            return canGroupable(view.manager.dataSource, property.id);
          }
          const dataType = property.dataType$.value;
          if (!dataType) {
            return false;
          }
          const groupByService = getGroupByService(view.manager.dataSource);
          return !!groupByService?.matcher.match(dataType);
        })
        .map<MenuConfig>(property =>
          menu.action({
            name: property.name$.value,
            isSelected: group.property$.value?.id === property.id,
            prefix: html`<uni-lit .uni="${property.icon}"></uni-lit>`,
            select: () => {
              group.changeGroup(property.id);
              onSelect(property.id);
              return false;
            },
          })
        ),
    }),
    menu.group({
      items: [
        menu.action({
          prefix: DeleteIcon(),
          hide: () =>
            view instanceof KanbanSingleView || !group.property$.value,
          class: { 'delete-item': true },
          name: 'Remove Grouping',
          select: () => {
            group.changeGroup(undefined);
            onSelect(undefined);
            return false;
          },
        }),
      ],
    }),
  ];
};

export const buildGroupSettingItems = (
  group: GroupTrait,
  onGroupByClick: () => void,
  onGroupRemoved?: () => void
): MenuConfig[] => {
  const view = group.view;
  const gProp = group.property$.value;
  if (!gProp) return [];
  const type = gProp.type$.value;
  if (!type) return [];
  const icon = gProp.icon;

  return [
    menu.group({
      items: [
        menu.action({
          name: 'Group By',
          postfix: html`
            <div
              style="display:flex;align-items:center;gap:4px;font-size:14px;line-height:20px;color:var(--notesgraph-text-secondary-color);margin-left:8px;"
              class="dv-icon-16"
            >
              ${renderUniLit(icon, {})} ${gProp.name$.value}
            </div>
          `,
          select: () => {
            onGroupByClick();
            return false;
          },
        }),
      ],
    }),

    ...(type === 'date'
      ? [
          menu.group({
            items: [
              menu.dynamic(() => [
                menu.subMenu({
                  name: 'Date by',
                  openOnHover: false,
                  middleware: dropdownSubMenuMiddleware,
                  autoHeight: true,
                  postfix: html`
                    <div
                      style="display:flex;align-items:center;gap:4px;font-size:14px;line-height:20px;color:var(--notesgraph-text-secondary-color);margin-left:30px;"
                    >
                      ${dateModeLabel(group.groupInfo$.value?.config.name)}
                    </div>
                  `,
                  options: {
                    items: [
                      menu.dynamic(() =>
                        (
                          [
                            ['Relative', 'date-relative'],
                            ['Day', 'date-day'],
                            [
                              'Week',
                              group.groupInfo$.value?.config.name ===
                              'date-week-mon'
                                ? 'date-week-mon'
                                : 'date-week-sun',
                            ],
                            ['Month', 'date-month'],
                            ['Year', 'date-year'],
                          ] as [string, string][]
                        ).map(
                          ([label, key]): MenuConfig =>
                            menu.action({
                              name: label,
                              label: () => {
                                const isSelected =
                                  group.groupInfo$.value?.config.name === key;
                                return html`<span
                                  style="font-size:14px;color:${isSelected
                                    ? 'var(--notesgraph-text-emphasis-color)'
                                    : 'var(--notesgraph-text-secondary-color)'}"
                                  >${label}</span
                                >`;
                              },
                              isSelected:
                                group.groupInfo$.value?.config.name === key,
                              select: () => {
                                group.changeGroupMode(key);
                                return false;
                              },
                            })
                        )
                      ),
                    ],
                  },
                }),
              ]),
            ],
          }),

          ...(group.groupInfo$.value?.config.name?.startsWith('date-week')
            ? [
                menu.group({
                  items: [
                    menu.dynamic(() => [
                      menu.subMenu({
                        name: 'Start week on',
                        postfix: html`
                          <div
                            style="display:flex;align-items:center;gap:4px;font-size:14px;line-height:20px;color:var(--notesgraph-text-secondary-color);margin-left:8px;"
                          >
                            ${group.groupInfo$.value?.config.name ===
                            'date-week-mon'
                              ? 'Monday'
                              : 'Sunday'}
                          </div>
                        `,
                        options: {
                          items: [
                            menu.dynamic(() =>
                              (
                                [
                                  ['Monday', 'date-week-mon'],
                                  ['Sunday', 'date-week-sun'],
                                ] as [string, string][]
                              ).map(([label, key]) =>
                                menu.action({
                                  name: label,
                                  label: () => {
                                    const isSelected =
                                      group.groupInfo$.value?.config.name ===
                                      key;
                                    return html`<span
                                      style="font-size:14px;color:${isSelected
                                        ? 'var(--notesgraph-text-emphasis-color)'
                                        : 'var(--notesgraph-text-secondary-color)'}"
                                      >${label}</span
                                    >`;
                                  },
                                  isSelected:
                                    group.groupInfo$.value?.config.name === key,
                                  select: () => {
                                    group.changeGroupMode(key);
                                    return false;
                                  },
                                })
                              )
                            ),
                          ],
                        },
                      }),
                    ]),
                  ],
                }),
              ]
            : []),
          menu.group({
            items: [
              menu.dynamic(() => [
                menu.subMenu({
                  name: 'Sort',
                  openOnHover: false,
                  middleware: dropdownSubMenuMiddleware,
                  autoHeight: true,
                  postfix: html`
                    <div
                      style="display:flex;align-items:center;gap:4px;font-size:14px;line-height:20px;color:var(--notesgraph-text-secondary-color);margin-left:8px;"
                    >
                      ${group.sortAsc$.value ? 'Oldest first' : 'Newest first'}
                    </div>
                  `,
                  options: {
                    items: [
                      menu.dynamic(() => [
                        menu.action({
                          name: 'Oldest first',
                          label: () => {
                            const isSelected = group.sortAsc$.value;
                            return html`<span
                              style="font-size:14px;color:${isSelected
                                ? 'var(--notesgraph-text-emphasis-color)'
                                : 'var(--notesgraph-text-secondary-color)'}"
                              >Oldest first</span
                            >`;
                          },
                          isSelected: group.sortAsc$.value,
                          select: () => {
                            group.setDateSortOrder(true);
                            return false;
                          },
                        }),
                        menu.action({
                          name: 'Newest first',
                          label: () => {
                            const isSelected = !group.sortAsc$.value;
                            return html`<span
                              style="font-size:14px;color:${isSelected
                                ? 'var(--notesgraph-text-emphasis-color)'
                                : 'var(--notesgraph-text-secondary-color)'}"
                              >Newest first</span
                            >`;
                          },
                          isSelected: !group.sortAsc$.value,
                          select: () => {
                            group.setDateSortOrder(false);
                            return false;
                          },
                        }),
                      ]),
                    ],
                  },
                }),
              ]),
            ],
          }),
        ]
      : []),

    menu.group({
      items: [
        menu.dynamic(() => [
          menu.action({
            name: 'Hide empty groups',
            isSelected: group.hideEmpty$.value,
            select: () => {
              group.setHideEmpty(!group.hideEmpty$.value);
              return false;
            },
          }),
        ]),
      ],
    }),
    menu.group({
      items: [
        menuObj => html`
          <data-view-group-setting
            @mouseenter=${() => menuObj.closeSubMenu()}
            .groupTrait=${group}
            .columnId=${gProp.id}
          ></data-view-group-setting>
        `,
      ],
    }),

    menu.group({
      items: [
        menu.action({
          name: 'Remove grouping',
          prefix: DeleteIcon(),
          class: { 'delete-item': true },
          hide: () => !(view instanceof TableSingleView),
          select: () => {
            group.changeGroup(undefined);
            onGroupRemoved?.();
            return false;
          },
        }),
      ],
    }),
  ];
};
