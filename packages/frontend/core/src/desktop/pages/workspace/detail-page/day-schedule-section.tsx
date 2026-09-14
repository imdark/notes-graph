import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import {
  formatTimeRange,
  type ScheduleOccurrence,
  ScheduleService,
} from '@notesgraph/core/modules/schedule';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import * as styles from './day-schedule-section.css';

/**
 * The schedule for a single day, shown at the top of a journal doc (above the
 * written notes): recurring notes/blocks due that day + blocks scheduled on it.
 */
export const DayScheduleSection = ({ date }: { date: string }) => {
  const t = useI18n();
  const scheduleService = useService(ScheduleService);
  const workbench = useService(WorkbenchService).workbench;
  const dialogService = useService(WorkspaceDialogService);

  const all = useLiveData(
    useMemo(
      () => scheduleService.occurrencesInRange$(date, date),
      [date, scheduleService]
    )
  );
  const occurrences = useMemo(
    () => all.filter(o => o.recurring || o.blockId),
    [all]
  );

  const open = useCallback(
    (occ: ScheduleOccurrence) => {
      if (occ.blockId) {
        workbench.open(`/${occ.docId}?blockIds=${occ.blockId}`, {
          at: 'active',
        });
      } else {
        workbench.openDoc(occ.docId);
      }
    },
    [workbench]
  );

  // open the date+time editor for a scheduled block, anchored at the chip
  const editTime = useCallback(
    (occ: ScheduleOccurrence, anchor: HTMLElement) => {
      if (!occ.blockId) return;
      const rect = anchor.getBoundingClientRect();
      dialogService.open('block-schedule', {
        docId: occ.docId,
        blockId: occ.blockId,
        text: occ.title,
        position: [rect.left, rect.bottom, rect.width, 0],
      });
    },
    [dialogService]
  );

  if (occurrences.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.section}>
        <div className={styles.header}>
          {t['com.notesgraph.schedule.scheduledToday']()}
          <span className={styles.count}>{occurrences.length}</span>
        </div>
        {occurrences.map((occ, i) => {
          const timeLabel = formatTimeRange(occ.time, occ.endTime);
          return (
            <div
              key={`${occ.docId}:${occ.blockId ?? ''}:${i}`}
              className={styles.row}
              onClick={() => open(occ)}
            >
              <span className={styles.dot} />
              <span className={styles.title}>{occ.title}</span>
              {occ.ruleLabel ? (
                <span className={styles.badge}>{occ.ruleLabel}</span>
              ) : null}
              {occ.blockId ? (
                <span
                  className={styles.timeChip}
                  onClick={e => {
                    e.stopPropagation();
                    editTime(occ, e.currentTarget);
                  }}
                >
                  {timeLabel || t['com.notesgraph.schedule.time']()}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
