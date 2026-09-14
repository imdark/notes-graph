import { DateTimeIcon, DoneIcon } from '@blocksuite/icons/rc';
import { MenuItem, MenuSub, notify } from '@notesgraph/component';
import {
  describeRule,
  type RecurrenceRule,
  ScheduleService,
  todayISO,
  weekdayOf,
} from '@notesgraph/core/modules/schedule';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

const sameRule = (
  a: RecurrenceRule | undefined,
  b: RecurrenceRule
): boolean => {
  if (!a || a.freq !== b.freq) return false;
  if (a.freq === 'weekly' && b.freq === 'weekly') {
    const sort = (xs: number[]) => [...xs].sort((x, y) => x - y).join(',');
    return sort(a.weekdays) === sort(b.weekdays);
  }
  if (a.freq === 'monthly' && b.freq === 'monthly') return a.day === b.day;
  return true; // daily
};

/**
 * A "Repeat" submenu of quick recurrence presets for a single doc. Anchored on
 * today; full weekday customization lives on the Schedule page.
 */
export const DocRepeatMenuSub = ({ docId }: { docId: string }) => {
  const t = useI18n();
  const scheduleService = useService(ScheduleService);
  const current = useLiveData(scheduleService.docSchedule$(docId));

  const presets = useMemo(() => {
    const today = todayISO();
    const wd = weekdayOf(today);
    const dom = Number(today.slice(8, 10));
    const items: { rule: RecurrenceRule; label: string }[] = [
      {
        rule: { freq: 'daily' },
        label: describeRule({ start: today, rule: { freq: 'daily' } }),
      },
      {
        rule: { freq: 'weekly', weekdays: [wd] },
        label: describeRule({
          start: today,
          rule: { freq: 'weekly', weekdays: [wd] },
        }),
      },
      {
        rule: { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] },
        label: t['com.notesgraph.schedule.everyWeekday'](),
      },
      {
        rule: { freq: 'monthly', day: dom },
        label: describeRule({
          start: today,
          rule: { freq: 'monthly', day: dom },
        }),
      },
    ];
    return items;
  }, [t]);

  const apply = useCallback(
    (rule: RecurrenceRule) => {
      scheduleService.setDocSchedule(docId, { start: todayISO(), rule });
      notify.success({ title: t['com.notesgraph.schedule.created']() });
    },
    [docId, scheduleService, t]
  );

  const stop = useCallback(() => {
    scheduleService.removeDocSchedule(docId);
    notify.success({ title: t['com.notesgraph.schedule.stopped']() });
  }, [docId, scheduleService, t]);

  return (
    <MenuSub
      triggerOptions={{ prefixIcon: <DateTimeIcon /> }}
      items={
        <>
          <MenuItem
            prefixIcon={!current ? <DoneIcon /> : undefined}
            onSelect={stop}
          >
            {t['com.notesgraph.schedule.dontRepeat']()}
          </MenuItem>
          {presets.map(preset => (
            <MenuItem
              key={preset.label}
              prefixIcon={
                sameRule(current?.rule, preset.rule) ? <DoneIcon /> : undefined
              }
              onSelect={() => apply(preset.rule)}
            >
              {preset.label}
            </MenuItem>
          ))}
        </>
      }
    >
      {t['com.notesgraph.schedule.repeat']()}
    </MenuSub>
  );
};
