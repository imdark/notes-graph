/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { Agent } from '../stores/agents';
import { COMPILE_SOURCE_TEMPLATE } from './agent-templates';
import {
  COMPILE_AGENT_NAME,
  compileBrief,
  compileSourceOf,
  findCompileAgent,
} from './compile-source';

const agent = (patch: Partial<Agent>): Agent => ({
  id: 'a',
  scope: 'personal',
  name: 'Other',
  instructions: 'something else',
  tools: [],
  targets: ['doc'],
  output: 'panel',
  maxSteps: 8,
  enabled: true,
  createdAt: 0,
  ...patch,
});

describe('compileSourceOf', () => {
  test('a note the user wrote is not a source', () => {
    expect(compileSourceOf({ id: 'd' })).toBeNull();
    expect(compileSourceOf(undefined)).toBeNull();
  });

  test('a web clip, with and without the page it came from', () => {
    expect(
      compileSourceOf({
        clipSource: { url: 'https://example.com/a', clippedAt: 'x' },
      })
    ).toEqual({ kind: 'clip', url: 'https://example.com/a' });
    expect(compileSourceOf({ clipSource: { clippedAt: 'x' } })).toEqual({
      kind: 'clip',
      url: undefined,
    });
  });

  test("a Readwise highlight prefers the book's address to readwise.io", () => {
    expect(
      compileSourceOf({
        integrationType: 'readwise',
        'readwise:readwise_url': 'https://readwise.io/open/1',
        'readwise:source_url': 'https://example.com/book',
        'readwise:author': ' Ada ',
      })
    ).toEqual({
      kind: 'readwise',
      url: 'https://example.com/book',
      author: 'Ada',
    });
    expect(
      compileSourceOf({
        integrationType: 'readwise',
        'readwise:readwise_url': 'https://readwise.io/open/1',
        'readwise:source_url': '',
      })?.url
    ).toBe('https://readwise.io/open/1');
  });
});

describe('compileBrief', () => {
  const context = {
    label: 'note "Essay"',
    title: 'Essay',
    text: '# Note: Essay\n\nBody',
  };

  test('names the source note and the original above its text', () => {
    const brief = compileBrief(context, 'doc-1', {
      kind: 'clip',
      url: 'https://example.com/a',
    });
    expect(brief.title).toBe('Essay');
    expect(brief.label).toBe('compile note "Essay"');
    expect(brief.text).toContain('docId doc-1 (a web clip)');
    expect(brief.text).toContain('Original: https://example.com/a');
    expect(brief.text).toContain('and the original');
    expect(brief.text.endsWith('# Note: Essay\n\nBody')).toBe(true);
  });

  test('says when the original was not recorded', () => {
    const brief = compileBrief(context, 'doc-1', {
      kind: 'readwise',
      author: 'Ada',
    });
    expect(brief.text).toContain('a Readwise highlight');
    expect(brief.text).toContain('Original: not recorded');
    expect(brief.text).toContain('Author: Ada');
    expect(brief.text).not.toContain('and the original');
  });
});

describe('findCompileAgent', () => {
  const { instructions } = COMPILE_SOURCE_TEMPLATE.draft;

  test('finds it by name, then by instructions once renamed', () => {
    const byName = agent({ id: 'n', name: COMPILE_AGENT_NAME });
    const renamed = agent({ id: 'r', name: 'Mine', instructions });
    expect(findCompileAgent([agent({}), byName, renamed], instructions)).toBe(
      byName
    );
    expect(findCompileAgent([agent({}), renamed], instructions)).toBe(renamed);
    expect(findCompileAgent([agent({})], instructions)).toBeUndefined();
  });
});
