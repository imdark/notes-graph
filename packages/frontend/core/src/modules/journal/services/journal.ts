import { LiveData, Service } from '@notesgraph/infra';
import dayjs from 'dayjs';

import type { DocsService } from '../../doc';
import type { Project, ProjectsService } from '../../projects';
import type { TemplateDocService } from '../../template-doc';
import type { JournalStore } from '../store/journal';

export type MaybeDate = Date | string | number;

export const JOURNAL_DATE_FORMAT = 'YYYY-MM-DD';

export class JournalService extends Service {
  constructor(
    private readonly store: JournalStore,
    private readonly docsService: DocsService,
    private readonly templateDocService: TemplateDocService,
    private readonly projectsService: ProjectsService
  ) {
    super();
  }

  allJournalDates$ = this.store.allJournalDates$;
  allJournalDocIds$ = this.store.allJournalDocIds$;

  journalDate$(docId: string) {
    return LiveData.from(this.store.watchDocJournalDate(docId), undefined);
  }
  journalToday$(docId: string) {
    return LiveData.computed(get => {
      const date = get(this.journalDate$(docId));
      if (!date) return false;
      return dayjs(date).isSame(dayjs(), 'day');
    });
  }

  setJournalDate(docId: string, date: string) {
    this.store.setDocJournalDate(docId, date);
  }

  removeJournalDate(docId: string) {
    this.store.removeDocJournalDate(docId);
  }

  journalsByDate$(date: string) {
    return this.store.docsByJournalDate$(date);
  }

  private createJournal(maybeDate: MaybeDate) {
    const day = dayjs(maybeDate);
    const title = day.format(JOURNAL_DATE_FORMAT);
    const docRecord = this.docsService.createDoc({
      title,
    });
    // set created date to match the journal date
    docRecord.setMeta({
      createDate: dayjs()
        .set('year', day.year())
        .set('month', day.month())
        .set('date', day.date())
        .toDate()
        .getTime(),
    });

    const enablePageTemplate =
      this.templateDocService.setting.enablePageTemplate$.value;
    const pageTemplateDocId =
      this.templateDocService.setting.pageTemplateDocId$.value;
    const journalTemplateDocId =
      this.templateDocService.setting.journalTemplateDocId$.value;
    // if journal template configured
    if (journalTemplateDocId) {
      this.docsService
        .duplicateFromTemplate(journalTemplateDocId, docRecord.id)
        .catch(console.error);
    }
    // journal template not configured, use page template
    else if (enablePageTemplate && pageTemplateDocId) {
      this.docsService
        .duplicateFromTemplate(pageTemplateDocId, docRecord.id)
        .catch(console.error);
    }
    // No template configured — scaffold a section per project (default on),
    // so each day starts structured around the current projects.
    else if (
      this.templateDocService.setting.enableJournalProjectSections$.value
    ) {
      this.applyProjectSections(docRecord.id).catch(console.error);
    }
    this.setJournalDate(docRecord.id, title);
    return docRecord;
  }

  /**
   * Scaffold the new journal with one section per project. Waits for the
   * projects list to actually load first: reading `projects$.value`
   * synchronously returns `undefined` while the Projects entity is cold, which
   * on mobile (where the Projects sidebar that would warm it isn't mounted)
   * silently produced an empty list and skipped the per-project headers.
   */
  private async applyProjectSections(docId: string) {
    const projects = this.projectsService.projects;
    // Kick a load for cloud workspaces (local ones use a live watch already).
    projects.revalidate().catch(() => {});
    let list: Project[];
    try {
      list = await projects.projects$.waitForNonNull(AbortSignal.timeout(5000));
    } catch {
      list = projects.projects$.value ?? [];
    }
    await this.docsService.addJournalProjectSections(
      docId,
      list.map(project => ({ id: project.id, name: project.name }))
    );
  }

  ensureJournalByDate(maybeDate: MaybeDate) {
    const day = dayjs(maybeDate);
    const title = day.format(JOURNAL_DATE_FORMAT);
    const docs = this.journalsByDate$(title).value;
    if (docs.length) return docs[0];
    return this.createJournal(maybeDate);
  }
}
