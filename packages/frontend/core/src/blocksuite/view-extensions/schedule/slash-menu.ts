import { DateTimeIcon } from '@blocksuite/icons/lit';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph/components/context-menu';
import { SlashMenuConfigExtension } from '@blocksuite/notesgraph/widgets/slash-menu';
import type { FrameworkProvider } from '@notesgraph/infra';

import { WorkspaceDialogService } from '../../../modules/dialogs';
import {
  describeRule,
  type RecurrenceRule,
  ScheduleService,
  todayISO,
  type Weekday,
} from '../../../modules/schedule';

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

/**
 * Two slash commands for blocks:
 *  - "/Schedule" — put the block on a specific date (one-off), via the date picker.
 *  - "/Repeat" — make the block recur on a rule.
 * Both surface the block on the Schedule page and journal calendar.
 */
export function ScheduleSlashMenuConfigExtension(framework: FrameworkProvider) {
  return SlashMenuConfigExtension('notesgraph-schedule', {
    items: [
      {
        name: 'Schedule',
        description: 'Put this block on a specific date',
        icon: DateTimeIcon(),
        group: '4_Content & Media@11',
        searchAlias: ['schedule', 'date', 'due', 'when'],
        when: ({ model }) => !!model.text,
        action: ({ model, std }) => {
          const docId = model.store.id;
          const blockId = model.id;
          const text = model.text?.toString() ?? '';
          const rect = std.view.getBlock(blockId)?.getBoundingClientRect();
          framework.get(WorkspaceDialogService).open('block-schedule', {
            docId,
            blockId,
            text,
            position: rect
              ? [rect.left, rect.bottom, rect.width, 0]
              : undefined,
          });
        },
      },
      {
        name: 'Repeat',
        description: 'Make this block repeat on a schedule',
        icon: DateTimeIcon(),
        group: '4_Content & Media@12',
        searchAlias: ['repeat', 'recur', 'recurring'],
        when: ({ model }) => !!model.text,
        action: ({ model, std }) => {
          const docId = model.store.id;
          const blockId = model.id;
          const text = model.text?.toString() ?? '';
          const blockEl = std.view.getBlock(blockId);
          if (!blockEl) return;
          const scheduleService = framework.get(ScheduleService);
          const today = todayISO();
          const dom = Number(today.slice(8, 10));
          const apply = (rule: RecurrenceRule) =>
            scheduleService.setBlockRepeat(
              docId,
              blockId,
              { start: today, rule },
              text
            );

          popMenu(popupTargetFromElement(blockEl), {
            options: {
              items: [
                menu.action({
                  name: "Don't repeat",
                  select: () =>
                    scheduleService.removeBlockSchedule(docId, blockId),
                }),
                menu.action({
                  name: 'Every day',
                  select: () => apply({ freq: 'daily' }),
                }),
                menu.subMenu({
                  name: 'Weekly',
                  options: {
                    items: [
                      ...WEEKDAYS.map(w =>
                        menu.action({
                          name: w.label,
                          select: () =>
                            apply({ freq: 'weekly', weekdays: [w.value] }),
                        })
                      ),
                      menu.action({
                        name: 'Every weekday',
                        select: () =>
                          apply({
                            freq: 'weekly',
                            weekdays: [1, 2, 3, 4, 5],
                          }),
                      }),
                    ],
                  },
                }),
                menu.action({
                  name: describeRule({
                    start: today,
                    rule: { freq: 'monthly', day: dom },
                  }),
                  select: () => apply({ freq: 'monthly', day: dom }),
                }),
              ],
            },
          });
        },
      },
    ],
  });
}
