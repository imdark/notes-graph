import { describe, expect, test } from 'vitest';

import {
  answerToNoteMarkdown,
  deriveNoteTitle,
  parseCitations,
} from './answer-to-note';

const BASE = 'https://app.example.com/workspace/ws1';
const titles: Record<string, string> = {
  doc1: 'Project plan',
  doc2: 'Meeting [notes]',
};
const options = {
  docUrl: (docId: string, blockId?: string) =>
    blockId ? `${BASE}/${docId}?blockIds=${blockId}` : `${BASE}/${docId}`,
  docTitle: (docId: string) => titles[docId],
};

describe('parseCitations', () => {
  test('takes citation definitions out of the text', () => {
    const { body, citations } = parseCitations(
      [
        'The plan ships in May[^1].',
        '',
        '[^1]:{"type":"doc","docId":"doc1"}',
        '[^2]: {"type":"url","url":"https%3A%2F%2Fexample.com%2Fa%3Fb%3D1"}',
      ].join('\n')
    );
    expect(body).toBe('The plan ships in May[^1].');
    expect(citations.get('1')).toMatchObject({ type: 'doc', docId: 'doc1' });
    // URLs in definitions are encoded by the server.
    expect(citations.get('2')).toMatchObject({
      type: 'url',
      url: 'https://example.com/a?b=1',
    });
  });

  test('leaves plain footnotes and code alone', () => {
    const md = [
      'Text[^a].',
      '',
      '[^a]: just a note',
      '```',
      '[^1]:{"type":"doc","docId":"doc1"}',
      '```',
    ].join('\n');
    const { body, citations } = parseCitations(md);
    expect(citations.size).toBe(0);
    expect(body).toBe(md);
  });
});

describe('answerToNoteMarkdown', () => {
  test('turns a doc citation into a doc link and lists it under Sources', () => {
    const md = answerToNoteMarkdown(
      'The plan ships in May[^1].\n\n[^1]:{"type":"doc","docId":"doc1"}',
      options
    );
    expect(md).toBe(
      [
        `The plan ships in May [Project plan](${BASE}/doc1).`,
        '',
        '## Sources',
        '',
        `- [Project plan](${BASE}/doc1)`,
        '',
      ].join('\n')
    );
  });

  test('turns a web citation into a URL link', () => {
    const md = answerToNoteMarkdown(
      [
        'It rains a lot[^1] and more[^2].',
        '',
        '[^1]: {"type":"url","url":"https%3A%2F%2Fwww.example.com%2Fweather"}',
        '[^2]: {"type":"url","url":"https://news.example.org/x (1)","title":"News"}',
      ].join('\n'),
      options
    );
    expect(md).toContain(
      'It rains a lot ([example.com](https://www.example.com/weather)) and more ([News](https://news.example.org/x%20%281%29)).'
    );
    expect(md).toContain(
      '- [https://www.example.com/weather](https://www.example.com/weather)'
    );
    expect(md).toContain('- [News](https://news.example.org/x%20%281%29)');
  });

  test('lists each source once, in citation order', () => {
    const md = answerToNoteMarkdown(
      [
        'A[^1] B[^2] C[^3].',
        '',
        '[^1]:{"type":"doc","docId":"doc2"}',
        '[^2]:{"type":"doc","docId":"doc1"}',
        '[^3]:{"type":"doc","docId":"doc2"}',
      ].join('\n'),
      options
    );
    const sources = md.split('## Sources\n\n')[1].trim().split('\n');
    expect(sources).toEqual([
      `- [Meeting \\[notes\\]](${BASE}/doc2)`,
      `- [Project plan](${BASE}/doc1)`,
    ]);
  });

  test('falls back to Untitled for a doc it has no title for', () => {
    const md = answerToNoteMarkdown(
      'X[^1]\n\n[^1]:{"type":"doc","docId":"gone"}',
      options
    );
    expect(md).toContain(`X [Untitled](${BASE}/gone)`);
  });

  test('drops references it cannot link, but names the file in Sources', () => {
    const md = answerToNoteMarkdown(
      'See the report[^1].\n\n[^1]:{"type":"attachment","blobId":"b1","fileName":"report_v2.pdf"}',
      options
    );
    expect(md).toContain('See the report.');
    expect(md).toContain('- report\\_v2.pdf');
  });

  test('keeps references that have no citation, and code as it is', () => {
    const md = answerToNoteMarkdown(
      [
        'Use `arr[^1]` here[^1] and[^9].',
        '```',
        'x[^1]',
        '```',
        '',
        '[^1]:{"type":"doc","docId":"doc1"}',
      ].join('\n'),
      options
    );
    expect(md).toContain(
      `Use \`arr[^1]\` here [Project plan](${BASE}/doc1) and[^9].`
    );
    expect(md).toContain('```\nx[^1]\n```');
  });

  test('adds the given sources first, linking a block', () => {
    const md = answerToNoteMarkdown('No citations here.', {
      ...options,
      sources: [{ docId: 'doc1', blockId: 'blk' }],
    });
    expect(md).toBe(
      [
        'No citations here.',
        '',
        '## Sources',
        '',
        `- [Project plan](${BASE}/doc1?blockIds=blk)`,
        '',
      ].join('\n')
    );
  });

  test('leaves an answer without citations or sources unchanged', () => {
    expect(answerToNoteMarkdown('Just **text**.', options)).toBe(
      'Just **text**.'
    );
  });
});

describe('deriveNoteTitle', () => {
  test('takes an opening heading as the title, out of the body', () => {
    expect(deriveNoteTitle('\n# The *plan*\n---\n\nBody')).toEqual({
      title: 'The plan',
      body: 'Body',
    });
  });

  test('otherwise uses the first line, without markdown or citations', () => {
    expect(
      deriveNoteTitle('- **Ships** in [May](https://x.y)[^1].\nMore')
    ).toEqual({
      title: 'Ships in May.',
      body: '- **Ships** in [May](https://x.y)[^1].\nMore',
    });
  });

  test('cuts a long first line at a word', () => {
    const { title } = deriveNoteTitle(`${'word '.repeat(40)}end`);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('word…')).toBe(true);
  });

  test('gives no title for an empty answer or one opening with code', () => {
    expect(deriveNoteTitle('  \n').title).toBe('');
    expect(deriveNoteTitle('```ts\ncode\n```').title).toBe('');
  });
});
