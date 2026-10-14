import * as Y from 'yjs';

import type { DocReader } from '../../../core/doc';
import { parseDocToMarkdownFromDocSnapshot } from '../../../core/utils/blocksuite';

/**
 * Outline-first reading: a doc's heading tree, with block ids, and one
 * section at a time — so an agent can skim a long note by its structure and
 * then read (or edit, by block id) only the part it needs.
 *
 * Headings come from the doc's CRDT (a paragraph block whose type is h1–h6),
 * not from the markdown: in the markdown a heading and a paragraph that
 * starts with a literal "# " look the same. The section text comes from the
 * doc's AI-editable markdown, where each top-level block is preceded by a
 * `<!-- block_id=… flavour=… -->` comment, so a section is a run of those
 * blocks and keeps their ids.
 */

export type HeadingBlock = { level: number; title: string };

export type OutlineHeading = {
  blockId: string;
  level: number;
  title: string;
  /** Block id of the nearest enclosing heading, if any. */
  parentBlockId: string | null;
  /** Characters in the section (sans block_id comments), sub-sections included. */
  length: number;
  /** Top-level blocks in the section, its heading and sub-sections included. */
  blocks: number;
};

export type DocOutline = {
  /** Characters in the whole doc (sans block_id comments). */
  length: number;
  /** Content before the first heading, read with read_section on its blockId. */
  intro: { blockId: string; length: number; blocks: number } | null;
  headings: OutlineHeading[];
};

export type DocSection = {
  blockId: string;
  /** The section's markdown, each block preceded by its block_id comment. */
  markdown: string;
  blockIds: string[];
};

type Segment = { blockId: string; flavour: string; text: string };

const BLOCK_COMMENT_RE = /^<!-- block_id=(\S+) flavour=(\S+) -->\n/gm;
const HEADING_TYPE_RE = /^h([1-6])$/;

/** The doc's heading blocks, by block id, read from its CRDT binary. */
export function readHeadingBlocks(bin: Uint8Array): Map<string, HeadingBlock> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  const headings = new Map<string, HeadingBlock>();
  doc.getMap<Y.Map<unknown>>('blocks').forEach((block, id) => {
    if (!(block instanceof Y.Map)) return;
    if (block.get('sys:flavour') !== 'notesgraph:paragraph') return;
    const type = block.get('prop:type');
    const match = typeof type === 'string' && HEADING_TYPE_RE.exec(type);
    if (!match) return;
    const text = block.get('prop:text');
    headings.set(id, {
      level: Number(match[1]),
      title: (text instanceof Y.Text ? text.toString() : '').trim(),
    });
  });
  doc.destroy();
  return headings;
}

/** Splits AI-editable markdown into its top-level blocks, in doc order. */
function splitBlocks(markdown: string): Segment[] {
  const matches = [...markdown.matchAll(BLOCK_COMMENT_RE)];
  return matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    return { blockId: m[1], flavour: m[2], text: markdown.slice(start, end) };
  });
}

/** Index of the first segment after `from` that ends the section opened there. */
function sectionEnd(
  segments: Segment[],
  headings: Map<string, HeadingBlock>,
  from: number
): number {
  // a section opened by a non-heading block (the intro) runs to any heading
  const level = headings.get(segments[from].blockId)?.level ?? 0;
  for (let i = from + 1; i < segments.length; i++) {
    const next = headings.get(segments[i].blockId);
    if (next && (level === 0 || next.level <= level)) return i;
  }
  return segments.length;
}

const textLength = (segments: Segment[]) =>
  segments.reduce((sum, s) => sum + s.text.length, 0);

export function buildOutline(
  markdown: string,
  headings: Map<string, HeadingBlock>
): DocOutline {
  const segments = splitBlocks(markdown);
  const outline: OutlineHeading[] = [];
  const open: OutlineHeading[] = [];
  let intro: DocOutline['intro'] = null;

  segments.forEach((segment, i) => {
    const heading = headings.get(segment.blockId);
    if (!heading) {
      if (i === 0) {
        const section = segments.slice(0, sectionEnd(segments, headings, 0));
        intro = {
          blockId: segment.blockId,
          length: textLength(section),
          blocks: section.length,
        };
      }
      return;
    }
    while (open.length && open[open.length - 1].level >= heading.level) {
      open.pop();
    }
    const section = segments.slice(i, sectionEnd(segments, headings, i));
    const entry: OutlineHeading = {
      blockId: segment.blockId,
      level: heading.level,
      title: heading.title,
      parentBlockId: open.length ? open[open.length - 1].blockId : null,
      length: textLength(section),
      blocks: section.length,
    };
    outline.push(entry);
    open.push(entry);
  });

  return { length: textLength(segments), intro, headings: outline };
}

/**
 * The section that starts at `blockId`: for a heading, it and everything up
 * to the next heading of the same or a higher level; for any other top-level
 * block (e.g. the outline's intro), it up to the next heading.
 */
export function readSection(
  markdown: string,
  headings: Map<string, HeadingBlock>,
  blockId: string
): DocSection | null {
  const segments = splitBlocks(markdown);
  const start = segments.findIndex(s => s.blockId === blockId);
  if (start < 0) return null;
  const section = segments.slice(start, sectionEnd(segments, headings, start));
  return {
    blockId,
    markdown: section
      .map(
        s => `<!-- block_id=${s.blockId} flavour=${s.flavour} -->\n${s.text}`
      )
      .join('')
      .replace(/\s+$/, ''),
    blockIds: section.map(s => s.blockId),
  };
}

export type OutlineSource = {
  title: string;
  markdown: string;
  headings: Map<string, HeadingBlock>;
};

/** Reads the doc once, for both its AI-editable markdown and its headings. */
export async function loadOutlineSource(
  reader: DocReader,
  workspaceId: string,
  docId: string
): Promise<OutlineSource | null> {
  const doc = await reader.getDoc(workspaceId, docId);
  if (!doc?.bin?.length) return null;
  const { title, markdown } = parseDocToMarkdownFromDocSnapshot(
    workspaceId,
    docId,
    doc.bin,
    true
  );
  return { title, markdown, headings: readHeadingBlocks(doc.bin) };
}
