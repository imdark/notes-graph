import { type ReactNode } from 'react';

import * as styles from './agents.css';

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

const inline = (text: string): ReactNode[] =>
  text.split(INLINE).map((part, i) => {
    if (part.startsWith('`') && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      );
    }
    return part;
  });

/**
 * The model's reply as formatted text: headings, lists, code blocks, bold,
 * italic, inline code and links. Built as elements, never as HTML, so a reply
 * cannot inject markup. A fence still open while the reply streams renders as
 * code so far.
 */
export const AgentMarkdown = ({ text }: { text: string }) => {
  if (!text) return <p className={styles.output}>…</p>;
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```'))
        code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length} className={styles.mdCode}>
          <code>{code.join('\n')}</code>
        </pre>
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      }
      const children = items.map((item, n) => <li key={n}>{inline(item)}</li>);
      blocks.push(
        ordered ? (
          <ol key={blocks.length} className={styles.mdList}>
            {children}
          </ol>
        ) : (
          <ul key={blocks.length} className={styles.mdList}>
            {children}
          </ul>
        )
      );
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(
        <p key={blocks.length} className={styles.mdHeading}>
          {inline(line.replace(/^#{1,6}\s+/, ''))}
        </p>
      );
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('```') &&
        !/^(#{1,6}\s|\s*([-*]|\d+\.)\s+)/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      blocks.push(
        <p key={blocks.length} className={styles.mdParagraph}>
          {inline(para.join('\n'))}
        </p>
      );
    }
  }
  return <div className={styles.mdRoot}>{blocks}</div>;
};
