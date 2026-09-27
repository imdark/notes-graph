import { taskBodyIsEmpty } from '@blocksuite/notesgraph/shared/services';
import { describe, expect, it } from 'vitest';

/**
 * Which checkboxes a task view refuses to list.
 *
 * An empty checkbox is fine in a doc but renders as an "Untitled" row with
 * nothing to act on once collected into a task view. The interesting cases
 * are the ones that must NOT be swallowed: a task is often mostly status or
 * mostly a link, and neither makes it empty.
 */
describe('taskBodyIsEmpty', () => {
  it('is empty for a checkbox with no text at all', () => {
    expect(taskBodyIsEmpty([])).toBe(true);
    expect(taskBodyIsEmpty([{ insert: '' }])).toBe(true);
  });

  it('is empty for whitespace only', () => {
    expect(taskBodyIsEmpty([{ insert: '   ' }])).toBe(true);
    expect(taskBodyIsEmpty([{ insert: '\t \n' }])).toBe(true);
  });

  it('is empty for a status chip with nothing after it', () => {
    expect(
      taskBodyIsEmpty([{ insert: 'TODO', attributes: { orgStatus: 'TODO' } }])
    ).toBe(true);
    expect(
      taskBodyIsEmpty([
        { insert: 'TODO', attributes: { orgStatus: 'TODO' } },
        { insert: '  ' },
      ])
    ).toBe(true);
  });

  it('is empty for a raw typed status keyword with nothing after it', () => {
    expect(taskBodyIsEmpty([{ insert: 'TODO ' }])).toBe(true);
    expect(taskBodyIsEmpty([{ insert: 'DONE' }])).toBe(true);
  });

  it('is not empty once there is body text', () => {
    expect(taskBodyIsEmpty([{ insert: 'buy milk' }])).toBe(false);
    expect(
      taskBodyIsEmpty([
        { insert: 'TODO', attributes: { orgStatus: 'TODO' } },
        { insert: ' buy milk' },
      ])
    ).toBe(false);
    expect(taskBodyIsEmpty([{ insert: 'TODO buy milk' }])).toBe(false);
  });

  it('keeps a task whose whole body is a doc reference', () => {
    // The insert is a single space; the content is the attribute. Treating
    // this as empty would hide every "task that is just a link to a note".
    expect(
      taskBodyIsEmpty([
        { insert: ' ', attributes: { reference: { pageId: 'doc-1' } } },
      ])
    ).toBe(false);
  });

  it('keeps a task that is a status followed by a reference', () => {
    expect(
      taskBodyIsEmpty([
        { insert: 'TODO', attributes: { orgStatus: 'TODO' } },
        { insert: ' ', attributes: { reference: { pageId: 'doc-1' } } },
      ])
    ).toBe(false);
  });

  it('keeps a task whose body is inline latex', () => {
    expect(
      taskBodyIsEmpty([{ insert: ' ', attributes: { latex: 'x^2' } }])
    ).toBe(false);
  });

  it('ignores formatting attributes that carry no content', () => {
    // Bold whitespace is still whitespace.
    expect(
      taskBodyIsEmpty([{ insert: '  ', attributes: { bold: true } }])
    ).toBe(true);
    expect(
      taskBodyIsEmpty([{ insert: 'real', attributes: { bold: true } }])
    ).toBe(false);
  });

  it('treats a null attribute bag as no attributes', () => {
    expect(taskBodyIsEmpty([{ insert: ' ', attributes: null }])).toBe(true);
  });
});
