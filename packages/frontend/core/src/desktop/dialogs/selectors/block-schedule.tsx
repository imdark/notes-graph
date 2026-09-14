import { Button, DatePicker, Menu } from '@notesgraph/component';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { ScheduleService } from '@notesgraph/core/modules/schedule';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useState } from 'react';

/** Pick a date + optional time / time-range for a scheduled block. */
export const BlockScheduleDialog = ({
  close,
  docId,
  blockId,
  text,
  position,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['block-schedule']>) => {
  const t = useI18n();
  const scheduleService = useService(ScheduleService);
  const current = scheduleService.getBlockSchedule(docId, blockId);

  const [date, setDate] = useState<string | undefined>(current?.date);
  const [time, setTime] = useState(current?.time ?? '');
  const [endTime, setEndTime] = useState(current?.endTime ?? '');

  const onClose = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close]
  );

  const save = useCallback(() => {
    if (date) {
      scheduleService.setBlockSchedule(
        docId,
        blockId,
        { date, time, endTime },
        text
      );
    }
    close();
  }, [blockId, close, date, docId, endTime, scheduleService, text, time]);

  const remove = useCallback(() => {
    scheduleService.removeBlockSchedule(docId, blockId);
    close();
  }, [blockId, close, docId, scheduleService]);

  return (
    <Menu
      rootOptions={{ modal: true, open: true, onOpenChange: onClose }}
      contentOptions={{
        side: 'bottom',
        sideOffset: 8,
        align: 'start',
        style: {
          padding: 16,
          borderRadius: 8,
          background: cssVarV2('layer/background/primary'),
        },
      }}
      items={
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minWidth: 280,
          }}
        >
          <DatePicker
            weekDays={t['com.notesgraph.calendar-date-picker.week-days']()}
            monthNames={t['com.notesgraph.calendar-date-picker.month-names']()}
            todayLabel={t['com.notesgraph.calendar-date-picker.today']()}
            value={date}
            onChange={setDate}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                color: cssVarV2('text/secondary'),
                width: 40,
              }}
            >
              {t['com.notesgraph.schedule.time']()}
            </span>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
            />
            <span>–</span>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {current ? (
              <Button onClick={remove}>
                {t['com.notesgraph.schedule.remove']()}
              </Button>
            ) : null}
            <Button variant="primary" onClick={save} disabled={!date}>
              {t['com.notesgraph.schedule.save']()}
            </Button>
          </div>
        </div>
      }
    >
      <div
        style={
          position
            ? {
                position: 'fixed',
                left: position[0],
                top: position[1],
                width: position[2],
                height: position[3],
              }
            : {
                position: 'fixed',
                left: '50%',
                top: '50%',
                width: 0,
                height: 0,
              }
        }
      />
    </Menu>
  );
};
