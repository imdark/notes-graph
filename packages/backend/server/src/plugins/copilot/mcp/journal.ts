/**
 * A day's journal page made outside the app (by an agent filing a task):
 * the same outline the app scaffolds for a new day, a "## <project>" heading
 * with an empty to-do under it per project and a final "## Inbox". The app
 * adopts a page titled with a date that it has no journal for (see
 * JournalService.ensureJournalByDate): it marks it as that day's journal and
 * adds each section's "todos:" Task List, which markdown can't express.
 */

export const JOURNAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in UTC as YYYY-MM-DD. */
export function todayDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The markdown body of a new journal page with a section per project name. */
export function journalScaffold(projectNames: string[]): string {
  const names = [
    ...projectNames
      .map(n => n.trim())
      .filter(n => n && n.toLowerCase() !== 'inbox'),
    'Inbox',
  ];
  return names.map(name => `## ${name}\n\n- [ ] \n`).join('\n');
}
