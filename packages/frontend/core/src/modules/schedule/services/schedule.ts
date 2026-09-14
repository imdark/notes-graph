import { LiveData, Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import {
  describeRule,
  expandOccurrences,
  isISODate,
  type ScheduleRule,
} from '../recurrence';

export interface ScheduleOccurrence {
  /** the date this occurrence falls on, `YYYY-MM-DD` */
  date: string;
  /** doc to open: a materialized instance if one exists, otherwise the source */
  docId: string;
  /** the recurring source doc (same as `docId` for one-off scheduled notes) */
  sourceDocId: string;
  title: string;
  /** a real per-date instance doc exists (independently editable) */
  materialized: boolean;
  /** true for a recurring occurrence, false for a one-off scheduled (date) note */
  recurring: boolean;
  /** for a scheduled block, the block id within the doc to focus when opened */
  blockId?: string;
  /** time of day (HH:MM) and optional end time, for a scheduled block */
  time?: string;
  endTime?: string;
  /** human-readable recurrence label (recurring only), e.g. "Every Mon" */
  ruleLabel?: string;
}

export interface ScheduledDoc {
  docId: string;
  title: string;
  rule: ScheduleRule;
}

/**
 * Scheduled & repeating notes. A recurrence rule lives on the doc's `schedule`
 * property; occurrences are computed virtually over a date range (nothing is
 * duplicated). A single occurrence can be "materialized" on demand into a real
 * instance doc so it can be edited independently for that one date.
 */
export class ScheduleService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  docSchedule$(docId: string) {
    return LiveData.computed(get => {
      const doc = get(this.docsService.list.doc$(docId));
      if (!doc) return undefined;
      return get(doc.properties$.selector(p => p.schedule)) ?? undefined;
    });
  }

  setDocSchedule(docId: string, rule: ScheduleRule) {
    this.docsService.list.doc$(docId).value?.setProperty('schedule', rule);
  }

  removeDocSchedule(docId: string) {
    this.docsService.list.doc$(docId).value?.setProperty('schedule', undefined);
  }

  getBlockSchedule(docId: string, blockId: string) {
    return this.docsService.list.doc$(docId).value?.properties$.value
      .scheduleBlocks?.[blockId];
  }

  /** Reactive schedule entry for a single block (for the in-editor widget). */
  blockScheduleEntry$(docId: string, blockId: string) {
    return LiveData.computed(get => {
      const doc = get(this.docsService.list.doc$(docId));
      if (!doc) return undefined;
      return get(doc.properties$.selector(p => p.scheduleBlocks))?.[blockId];
    });
  }

  /** Schedule a block on a one-off date (+ optional time/range; clears repeat). */
  setBlockSchedule(
    docId: string,
    blockId: string,
    value: { date: string; time?: string; endTime?: string },
    text: string
  ) {
    const doc = this.docsService.list.doc$(docId).value;
    if (!doc) return;
    const blocks = { ...doc.properties$.value.scheduleBlocks };
    blocks[blockId] = {
      date: value.date,
      time: value.time || undefined,
      endTime: value.endTime || undefined,
      text,
    };
    doc.setProperty('scheduleBlocks', blocks);
  }

  /** Make a block repeat on a recurrence rule (replaces any one-off date). */
  setBlockRepeat(
    docId: string,
    blockId: string,
    rule: ScheduleRule,
    text: string
  ) {
    const doc = this.docsService.list.doc$(docId).value;
    if (!doc) return;
    const blocks = { ...doc.properties$.value.scheduleBlocks };
    blocks[blockId] = { rule, text };
    doc.setProperty('scheduleBlocks', blocks);
  }

  removeBlockSchedule(docId: string, blockId: string) {
    const doc = this.docsService.list.doc$(docId).value;
    if (!doc) return;
    const current = doc.properties$.value.scheduleBlocks;
    if (!current?.[blockId]) return;
    const blocks = { ...current };
    delete blocks[blockId];
    doc.setProperty('scheduleBlocks', blocks);
  }

  /** All recurring source docs. */
  scheduledDocs$ = LiveData.computed(get => {
    const nonTrash = new Set(get(this.docsService.list.nonTrashDocsIds$));
    const docs: ScheduledDoc[] = [];
    for (const doc of get(this.docsService.list.docs$)) {
      if (!nonTrash.has(doc.id)) continue;
      const rule = get(doc.properties$.selector(p => p.schedule));
      if (rule && isISODate(rule.start)) {
        docs.push({
          docId: doc.id,
          title: get(doc.title$) || 'Untitled',
          rule,
        });
      }
    }
    return docs;
  });

  /**
   * Every occurrence (recurring + one-off date-scheduled notes) within
   * `[rangeStart, rangeEnd]`, with materialized instances replacing the virtual
   * occurrence for their date.
   */
  occurrencesInRange$(rangeStart: string, rangeEnd: string) {
    return LiveData.computed(get => {
      const nonTrash = new Set(get(this.docsService.list.nonTrashDocsIds$));
      const docs = get(this.docsService.list.docs$).filter(d =>
        nonTrash.has(d.id)
      );
      const occurrences: ScheduleOccurrence[] = [];

      // `${sourceId}:${date}` -> materialized instance, to suppress the virtual
      // occurrence and surface the real (editable) instance instead.
      const materialized = new Map<string, { docId: string; title: string }>();
      for (const doc of docs) {
        const instance = get(doc.properties$.selector(p => p.scheduleInstance));
        if (instance?.source && isISODate(instance.date)) {
          materialized.set(`${instance.source}:${instance.date}`, {
            docId: doc.id,
            title: get(doc.title$) || 'Untitled',
          });
        }
      }

      for (const doc of docs) {
        const props = get(doc.properties$);
        const title = get(doc.title$) || 'Untitled';

        // scheduled blocks within this doc (independent of the doc's own rule)
        const blocks = props.scheduleBlocks;
        if (blocks) {
          for (const [blockId, entry] of Object.entries(blocks)) {
            if (!entry) continue;
            if (entry.rule && isISODate(entry.rule.start)) {
              // repeating block
              for (const date of expandOccurrences(
                entry.rule,
                rangeStart,
                rangeEnd
              )) {
                occurrences.push({
                  date,
                  docId: doc.id,
                  sourceDocId: doc.id,
                  blockId,
                  title: entry.text || title,
                  materialized: false,
                  recurring: true,
                  time: entry.time,
                  endTime: entry.endTime,
                  ruleLabel: describeRule(entry.rule),
                });
              }
            } else if (
              entry.date &&
              isISODate(entry.date) &&
              entry.date >= rangeStart &&
              entry.date <= rangeEnd
            ) {
              // one-off scheduled block
              occurrences.push({
                date: entry.date,
                docId: doc.id,
                sourceDocId: doc.id,
                blockId,
                title: entry.text || title,
                materialized: false,
                recurring: false,
                time: entry.time,
                endTime: entry.endTime,
              });
            }
          }
        }

        const schedule = props.schedule;

        if (schedule && isISODate(schedule.start)) {
          for (const date of expandOccurrences(
            schedule,
            rangeStart,
            rangeEnd
          )) {
            const instance = materialized.get(`${doc.id}:${date}`);
            occurrences.push({
              date,
              docId: instance ? instance.docId : doc.id,
              sourceDocId: doc.id,
              title: instance ? instance.title : title,
              materialized: !!instance,
              recurring: true,
              ruleLabel: describeRule(schedule),
            });
          }
          continue;
        }

        // one-off note scheduled on a date (a journal/date property), as long as
        // it isn't itself a materialized recurring instance.
        const journal = props.journal;
        if (
          !props.scheduleInstance &&
          isISODate(journal) &&
          journal >= rangeStart &&
          journal <= rangeEnd
        ) {
          occurrences.push({
            date: journal,
            docId: doc.id,
            sourceDocId: doc.id,
            title,
            materialized: false,
            recurring: false,
          });
        }
      }

      occurrences.sort(
        (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
      );
      return occurrences;
    });
  }

  /**
   * Create a real instance doc for one occurrence of a recurring note, so that
   * date can diverge from the series. Returns the new doc id.
   */
  materializeOccurrence(sourceDocId: string, date: string): string | undefined {
    const source = this.docsService.list.doc$(sourceDocId).value;
    if (!source) return undefined;
    const title = source.title$.value || 'Untitled';
    const record = this.docsService.createDoc({ title });
    record.setProperty('journal', date);
    record.setProperty('scheduleInstance', { source: sourceDocId, date });
    return record.id;
  }
}
