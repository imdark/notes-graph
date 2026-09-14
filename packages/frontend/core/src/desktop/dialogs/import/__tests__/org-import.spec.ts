import { describe, expect, test } from 'vitest';

import { orgToMarkdown } from '../org-import';

describe('orgToMarkdown', () => {
  test('title from #+TITLE, else the file name', () => {
    expect(orgToMarkdown('#+TITLE: My Notebook\n', 'file').title).toBe(
      'My Notebook'
    );
    expect(orgToMarkdown('* A heading\n', 'notebook-1').title).toBe(
      'notebook-1'
    );
  });

  test('headlines become markdown headings by level', () => {
    const md = orgToMarkdown('* Top\n** Sub\n*** Deep\n').markdown;
    expect(md).toContain('# Top');
    expect(md).toContain('## Sub');
    expect(md).toContain('### Deep');
  });

  test('TODO/DONE headlines become checkboxes, indented by depth', () => {
    const md = orgToMarkdown(
      '* Project\n** TODO Buy milk\n** DONE Ship it\n'
    ).markdown;
    expect(md).toContain('# Project');
    expect(md).toContain('  - [ ] Buy milk');
    expect(md).toContain('  - [x] Ship it');
  });

  test('trailing :tags: become #tags', () => {
    const md = orgToMarkdown('* Trip planning :travel:todo:\n').markdown;
    expect(md).toContain('# Trip planning #travel #todo');
  });

  test('property/logbook drawers are stripped', () => {
    const org =
      '* Task\n:PROPERTIES:\n:ID: abc-123\n:END:\nbody text\n:LOGBOOK:\nCLOCK: [2026-01-01]\n:END:\nmore body';
    const md = orgToMarkdown(org).markdown;
    expect(md).toContain('# Task');
    expect(md).toContain('body text');
    expect(md).toContain('more body');
    expect(md).not.toContain(':PROPERTIES:');
    expect(md).not.toContain(':ID:');
    expect(md).not.toContain(':LOGBOOK:');
  });

  test('org links and verbatim convert to markdown', () => {
    const md = orgToMarkdown(
      'See [[https://x.com][the site]] and =literal= text.\n'
    ).markdown;
    expect(md).toContain('[the site](https://x.com)');
    expect(md).toContain('`literal`');
  });

  test('org list checkbox [X] normalizes to [x]', () => {
    const md = orgToMarkdown('- [X] done item\n- [ ] open item\n').markdown;
    expect(md).toContain('- [x] done item');
    expect(md).toContain('- [ ] open item');
  });
});
