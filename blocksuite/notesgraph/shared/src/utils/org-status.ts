/**
 * Org-mode style status annotations at the start of a list item's text:
 * checkbox forms `[ ]` (todo), `[-]` (in progress), `[X]` (done), or an
 * uppercase TODO keyword such as `TODO`, `DONE`, `WAITING`. The annotation
 * is the plain-text source of truth for a row's status — kanban boards
 * mirroring the list read and write it, and the editor renders it as a
 * status chip.
 */

export type OrgStatusCanonical = {
  /** Display label; matches the kanban default select options. */
  label: string;
  /** The org plain-text form written into the document. */
  text: string;
};

export const ORG_STATUS_CANONICAL: OrgStatusCanonical[] = [
  { label: 'Todo', text: '[ ]' },
  { label: 'In Progress', text: '[-]' },
  { label: 'Done', text: '[X]' },
];

/**
 * Matches an org status annotation at the start of a string: a checkbox
 * form, or an uppercase keyword of 2+ chars (so a line starting with a
 * single capital letter isn't swallowed), followed by whitespace.
 */
const ORG_STATUS_PREFIX_RE = /^(\[(?: |x|X|-)\]|[A-Z][A-Z_-]{1,24})(?=\s)/;

/** The display label for an org status text (`[ ]`, `DONE`, `WAITING`…). */
export function orgStatusLabel(statusText: string): string {
  switch (statusText) {
    case '[ ]':
      return 'Todo';
    case '[-]':
      return 'In Progress';
    case '[x]':
    case '[X]':
      return 'Done';
    case 'TODO':
      return 'Todo';
    case 'DONE':
      return 'Done';
    case 'WIP':
    case 'STRT':
    case 'DOING':
      return 'In Progress';
    default:
      return statusText;
  }
}

/** The org plain-text form for a status label (kanban option name). */
export function orgStatusText(label: string): string {
  const canonical = ORG_STATUS_CANONICAL.find(
    v => v.label.toLowerCase() === label.toLowerCase()
  );
  if (canonical) {
    return canonical.text;
  }
  // Any other kanban option becomes an org TODO keyword.
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parses an org status annotation at the start of `text`.
 * Returns the matched annotation and its length (not counting the
 * whitespace that follows it), or null.
 */
export function parseOrgStatusPrefix(
  text: string
): { statusText: string; length: number } | null {
  const match = ORG_STATUS_PREFIX_RE.exec(text);
  if (!match) return null;
  return { statusText: match[1], length: match[1].length };
}

/** True when two statuses mean the same thing (`[x]` vs `Done` vs `DONE`). */
export function orgStatusMatches(statusText: string, label: string): boolean {
  return (
    orgStatusLabel(statusText).toLowerCase() ===
    orgStatusLabel(orgStatusText(label)).toLowerCase()
  );
}
