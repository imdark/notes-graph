export type OutlineEntry = {
  index: number;
  level: number;
  title: string;
  /** 1-based line of the heading in the document's markdown. */
  line: number;
  /** Characters in the section, from its heading to the next heading of the same or higher level. */
  length: number;
};

type Heading = { level: number; title: string; start: number; line: number };

function findHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let fence: string | null = null;
  let offset = 0;
  lines.forEach((text, i) => {
    const marker = /^\s*(```|~~~)/.exec(text)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!fence) {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text);
      if (m) {
        headings.push({
          level: m[1].length,
          title: m[2],
          start: offset,
          line: i + 1,
        });
      }
    }
    offset += text.length + 1;
  });
  return headings;
}

function sectionEnd(headings: Heading[], i: number, total: number): number {
  const next = headings.slice(i + 1).find(h => h.level <= headings[i].level);
  return next ? next.start : total;
}

export function buildOutline(markdown: string): OutlineEntry[] {
  const headings = findHeadings(markdown.split('\n'));
  return headings.map((h, i) => ({
    index: i,
    level: h.level,
    title: h.title,
    line: h.line,
    length: sectionEnd(headings, i, markdown.length) - h.start,
  }));
}

/** Text of the section at `index` in the outline, including its sub-sections. */
export function readSection(markdown: string, index: number): string | null {
  const headings = findHeadings(markdown.split('\n'));
  if (!Number.isInteger(index) || index < 0 || index >= headings.length) {
    return null;
  }
  return markdown
    .slice(headings[index].start, sectionEnd(headings, index, markdown.length))
    .replace(/\s+$/, '');
}
