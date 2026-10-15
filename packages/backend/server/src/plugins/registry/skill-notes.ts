import { Injectable, Logger } from '@nestjs/common';

import { DocReader } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import type { AgentSkill } from './agent-profiles';

/**
 * Notes as Claude Code skills. A note titled "Skill: <name>" (a runbook, say)
 * is a skill an agent can be given: the server renders it to a SKILL.md and
 * serves it at a path on itself, which the runner fetches with its own
 * token. A job names one as `note:<docId>`; when it is claimed, only notes
 * of the job's own workspace are looked up, so a job still can't point a
 * runner at an arbitrary URL.
 */

const TITLE = /^\s*skill\s*:\s*(.*\S)\s*$/i;
/** Claude Code's limits for a skill's frontmatter. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const NOTE_REF = 'note:';

/** What the note after "Skill:" is called, or null for any other note. */
export function skillNoteTitle(title: string | null | undefined): string | null {
  return TITLE.exec(title ?? '')?.[1] ?? null;
}

/**
 * The skill's name, as Claude Code wants it: lowercase letters, digits and
 * hyphens. Null for a note that isn't a skill, or one with nothing to name.
 */
export function skillNoteName(title: string | null | undefined): string | null {
  const shown = skillNoteTitle(title);
  if (!shown) return null;
  const name = shown
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_NAME)
    .replace(/^-+|-+$/g, '');
  return name || null;
}

/** How a job names a skill note among its skills. */
export const noteSkillRef = (docId: string) => `${NOTE_REF}${docId}`;

/** The note a job's skill names, or null for a catalog skill. */
export function noteSkillDocId(ref: string): string | null {
  return ref.startsWith(NOTE_REF) && ref.length > NOTE_REF.length
    ? ref.slice(NOTE_REF.length)
    : null;
}

/**
 * Where a skill note's SKILL.md is served. A path on the server rather than
 * a URL: the runner resolves it against the server it talks to, and only
 * such a path gets its token.
 */
export const noteSkillPath = (workspaceId: string, docId: string) =>
  `/api/registry/workspaces/${encodeURIComponent(workspaceId)}/skills/${encodeURIComponent(docId)}/SKILL.md`;

/** A skill note a job may be given, by the ref the job names it with. */
export interface NoteSkill {
  ref: string;
  skill: AgentSkill;
}

/** Inline markdown to plain text, for a one-line description. */
function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const DESCRIPTION_LINE = /^\s*(?:[*_]{1,2})?description(?:[*_]{1,2})?\s*:(?:[*_]{1,2})?\s*(.*)$/i;

/**
 * The description Claude Code shows for the skill and decides by when to
 * use it: a "Description: …" line if the note has one, otherwise its first
 * paragraph. Returns it with the body left once a description line is
 * taken out of it.
 */
function describe(body: string, fallback: string) {
  const lines = body.split('\n');
  const at = lines.findIndex(line => DESCRIPTION_LINE.test(line));
  if (at >= 0) {
    const description = plain(DESCRIPTION_LINE.exec(lines[at])![1]);
    if (description) {
      lines.splice(at, 1);
      return { description, body: lines.join('\n') };
    }
  }
  let fence = false;
  const paragraph: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      if (paragraph.length) break;
      continue;
    }
    if (fence) continue;
    const text = line.trim();
    if (!text || /^#{1,6}\s/.test(text) || /^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      if (paragraph.length) break;
      continue;
    }
    // A list or quote item counts as text, without its marker.
    paragraph.push(text.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/, ''));
  }
  return { description: plain(paragraph.join(' ')) || fallback, body };
}

/**
 * A skill note as a Claude Code SKILL.md: frontmatter with its name and
 * description, then the note. Null for a note that isn't a skill.
 */
export function renderSkillMd(note: { title: string; markdown: string }): string | null {
  const name = skillNoteName(note.title);
  const shown = skillNoteTitle(note.title);
  if (!name || !shown) return null;
  let body = note.markdown.replace(/\r\n?/g, '\n');
  // The note's own title, if the markdown repeats it, is the heading below.
  const lines = body.split('\n');
  const first = lines.findIndex(line => line.trim());
  if (first >= 0 && /^#\s/.test(lines[first]) && lines[first].replace(/^#\s+/, '').trim() === note.title.trim()) {
    lines.splice(first, 1);
    body = lines.join('\n');
  }
  const { description, body: rest } = describe(body, `${shown}, from a NotesGraph note.`);
  const clipped =
    description.length > MAX_DESCRIPTION
      ? `${description.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
      : description;
  // A JSON string is a YAML double-quoted scalar, so any text is safe here.
  return (
    `---\nname: ${name}\ndescription: ${JSON.stringify(clipped)}\n---\n\n` +
    `# ${shown}\n\n${rest.trim()}\n`
  );
}

/**
 * Which of the job's skills are skill notes it may have: of `notes` (the
 * job's own workspace's, that whoever started it can read), those the job
 * names and that are still titled as skills, in the job's order.
 */
export function pickNoteSkills(
  workspaceId: string,
  refs: readonly unknown[],
  notes: Array<{ docId: string; title: string | null }>
): NoteSkill[] {
  const byId = new Map(notes.map(note => [note.docId, note]));
  const picked: NoteSkill[] = [];
  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    const docId = noteSkillDocId(ref);
    const note = docId ? byId.get(docId) : undefined;
    const name = note && skillNoteName(note.title);
    if (!docId || !name || picked.some(p => p.ref === ref)) continue;
    picked.push({ ref, skill: { name, url: noteSkillPath(workspaceId, docId) } });
  }
  return picked;
}

export interface SkillNoteDto {
  /** What a job names it by among its skills. */
  ref: string;
  name: string;
  title: string;
  docId: string;
}

@Injectable()
export class SkillNoteService {
  private readonly logger = new Logger(SkillNoteService.name);

  constructor(
    private readonly models: Models,
    private readonly docReader: DocReader,
    private readonly ac: PermissionAccess
  ) {}

  /** The workspace's skill notes `userId` can read, for the agent editor. */
  async list(workspaceId: string, userId: string): Promise<SkillNoteDto[]> {
    const notes = await this.models.doc.findByTitlePrefix(workspaceId, 'skill');
    const skills: SkillNoteDto[] = [];
    for (const note of notes) {
      const name = skillNoteName(note.title);
      if (!name || !note.title) continue;
      const readable = await this.ac
        .user(userId)
        .doc(workspaceId, note.docId)
        .can('Doc.Read');
      if (!readable) continue;
      skills.push({ ref: noteSkillRef(note.docId), name, title: note.title, docId: note.docId });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The skill notes among a job's skills, as its runner fetches them. */
  async forJob(
    workspaceId: string,
    refs: unknown,
    createdBy: string | null
  ): Promise<NoteSkill[]> {
    if (!Array.isArray(refs)) return [];
    const docIds = refs
      .map(ref => (typeof ref === 'string' ? noteSkillDocId(ref) : null))
      .filter((id): id is string => !!id);
    if (!docIds.length) return [];
    try {
      const notes = await this.models.doc.findByTitlePrefix(workspaceId, 'skill', docIds);
      const readable = [];
      for (const note of notes) {
        if (
          !createdBy ||
          (await this.ac.user(createdBy).doc(workspaceId, note.docId).can('Doc.Read'))
        ) {
          readable.push(note);
        }
      }
      return pickNoteSkills(workspaceId, refs, readable);
    } catch (err) {
      // A run goes on without a skill it can't have, as the runner does.
      this.logger.warn(`skill notes for ${workspaceId} failed: ${err}`);
      return [];
    }
  }

  /** A skill note's SKILL.md; null when it's missing or not a skill. */
  async render(workspaceId: string, docId: string): Promise<{ name: string; text: string } | null> {
    const doc = await this.docReader.getDocMarkdown(workspaceId, docId, false);
    if (!doc) return null;
    const text = renderSkillMd(doc);
    const name = skillNoteName(doc.title);
    return text && name ? { name, text } : null;
  }
}
