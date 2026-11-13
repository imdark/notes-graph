import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { readStatus, type StatusEdit, writeStatus } from '../task-status';

/**
 * Tasks linked to pull requests, read and moved on straight on a doc's CRDT
 * (pure yjs, as task-status.ts): a task is linked to a pull request when its
 * text, or the text of any block under it, holds the pull request's URL or
 * the ticket key its branch starts with (`personal-259-…` → PERSONAL-259).
 *
 * The release sync moves linked tasks along as their code ships: in progress
 * (`[-]`) or COMMITTED to MERGED when the pull request merges, and any of
 * those or MERGED to DEPLOYED, with a note, when a deploy takes it live.
 * A plain to-do is never touched, nor anything already past the step.
 */

const TITLE_CHARS = 120;
/** How deep under a task its notes are read for a link. */
const MAX_DEPTH = 8;

export interface PullKey {
  number: number;
  /** The pull request's head branch, for its ticket key. */
  branch: string;
}

export interface TaskLink {
  blockId: string;
  title: string;
  status: string;
  /** The pull requests the task names, by number. */
  prs: number[];
}

/** The ticket key a branch starts with, upper-cased; null when none. */
export function ticketKey(branch: string): string | null {
  const match = /^([a-z]+-\d+)(?!\d)/i.exec(branch);
  return match ? match[1].toUpperCase() : null;
}

const escapeRe = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const blockText = (block: Y.Map<unknown>): string => {
  const text = block.get('prop:text');
  return text instanceof Y.Text ? text.toString() : '';
};

const childIds = (block: Y.Map<unknown>): string[] => {
  const children = block.get('sys:children');
  return children instanceof Y.Array ? (children.toArray() as string[]) : [];
};

/** A block's text and its descendants', one line each. */
function subtreeText(
  blocks: Y.Map<Y.Map<unknown>>,
  block: Y.Map<unknown>,
  depth = 0,
  seen = new Set<Y.Map<unknown>>()
): string {
  if (seen.has(block)) return '';
  seen.add(block);
  const lines = [blockText(block)];
  if (depth < MAX_DEPTH) {
    for (const id of childIds(block)) {
      const child = blocks.get(id);
      if (child instanceof Y.Map) {
        lines.push(subtreeText(blocks, child, depth + 1, seen));
      }
    }
  }
  return lines.join('\n');
}

function taskTitle(block: Y.Map<unknown>, statusLength: number): string {
  return blockText(block)
    .slice(statusLength)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_CHARS);
}

/** Which of `pulls` a text names, by URL or by its branch's ticket key. */
export function pullsNamed(
  text: string,
  repo: string,
  pulls: PullKey[]
): number[] {
  const named = new Set<number>();
  const urlRe = new RegExp(
    `https://github\\.com/${escapeRe(repo)}/pull/(\\d+)(?!\\d)`,
    'gi'
  );
  for (const match of text.matchAll(urlRe)) {
    const number = Number(match[1]);
    // A URL names its pull request even when it isn't among `pulls`.
    if (number > 0) named.add(number);
  }
  for (const pull of pulls) {
    if (named.has(pull.number)) continue;
    const key = ticketKey(pull.branch);
    if (!key) continue;
    if (new RegExp(`(?<![\\w-])${escapeRe(key)}(?!\\d)`, 'i').test(text)) {
      named.add(pull.number);
    }
  }
  return [...named].sort((a, b) => a - b);
}

/**
 * The tasks among `blockIds` and the pull requests of `repo` each names.
 * Blocks that aren't tasks, or name none, are left out.
 */
export function readTaskLinks(
  binary: Uint8Array,
  blockIds: string[],
  repo: string,
  pulls: PullKey[]
): TaskLink[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const links: TaskLink[] = [];
  for (const id of new Set(blockIds)) {
    const block = blocks.get(id);
    if (!(block instanceof Y.Map)) continue;
    const status = readStatus(block);
    if (!status) continue;
    const prs = pullsNamed(subtreeText(blocks, block), repo, pulls);
    if (!prs.length) continue;
    links.push({
      blockId: id,
      title: taskTitle(block, status.length),
      status: status.text,
      prs,
    });
  }
  return links;
}

const MERGES = new Set(['[-]', 'COMMITTED']);
const DEPLOYS = new Set(['[-]', 'COMMITTED', 'MERGED']);

/** The note a deploy leaves under a task it moved (the client's deployedNote). */
export const deployedNote = (commit: string, at: Date): string =>
  `Deployed ${commit.slice(0, 7)} on ${at.toLocaleDateString('en-US')}.`;

/** Add a paragraph holding `text` as the last child of `parent`. */
function appendChildParagraph(
  blocks: Y.Map<Y.Map<unknown>>,
  parent: Y.Map<unknown>,
  text: string
) {
  const id = nanoid(10);
  const block = new Y.Map<unknown>();
  const content = new Y.Text();
  content.insert(0, text);
  block.set('sys:id', id);
  block.set('sys:flavour', 'notesgraph:paragraph');
  block.set('sys:version', 1);
  block.set('sys:children', new Y.Array<string>());
  block.set('prop:type', 'text');
  block.set('prop:text', content);
  block.set('prop:collapsed', false);
  blocks.set(id, block);
  let children = parent.get('sys:children');
  if (!(children instanceof Y.Array)) {
    children = new Y.Array<string>();
    parent.set('sys:children', children);
  }
  (children as Y.Array<string>).push([id]);
}

function moveTasks(
  binary: Uint8Array,
  blockIds: string[],
  from: Set<string>,
  to: string,
  note: string | null
): StatusEdit {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  const before = Y.encodeStateVector(doc);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const changed: string[] = [];
  doc.transact(() => {
    for (const id of new Set(blockIds)) {
      const block = blocks.get(id);
      if (!(block instanceof Y.Map)) continue;
      const status = readStatus(block);
      if (!status || !from.has(status.text.trim().toUpperCase())) continue;
      writeStatus(block, status, to);
      if (note) appendChildParagraph(blocks, block, note);
      changed.push(id);
    }
  });
  return {
    update: changed.length ? Y.encodeStateAsUpdate(doc, before) : null,
    changed,
  };
}

/** A pull request merged: its in-progress and COMMITTED tasks are MERGED. */
export const mergeTasks = (binary: Uint8Array, blockIds: string[]) =>
  moveTasks(binary, blockIds, MERGES, 'MERGED', null);

/**
 * A deploy took the pull requests live: their in-progress, COMMITTED and
 * MERGED tasks are DEPLOYED, each with a "Deployed <sha7> on <date>." note.
 * A task already DEPLOYED (or on) is left alone, so a second call is a no-op.
 */
export const deployTasks = (
  binary: Uint8Array,
  blockIds: string[],
  commit: string,
  at: Date
) =>
  moveTasks(binary, blockIds, DEPLOYS, 'DEPLOYED', deployedNote(commit, at));
