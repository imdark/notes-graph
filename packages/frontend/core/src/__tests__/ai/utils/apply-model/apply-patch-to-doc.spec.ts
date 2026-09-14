/**
 * @vitest-environment happy-dom
 */

import { getInternalStoreExtensions } from '@blocksuite/notesgraph/extensions/store';
import { StoreExtensionManager } from '@blocksuite/notesgraph-ext-loader';
import { createNotesGraphTemplate } from '@blocksuite/notesgraph-shared/test-utils';
import type { Store } from '@blocksuite/store';
import { describe, expect, it } from 'vitest';

import { applyPatchToDoc } from '../../../../blocksuite/ai/utils/apply-model/apply-patch-to-doc';
import type { PatchOp } from '../../../../blocksuite/ai/utils/apply-model/markdown-diff';

declare module 'vitest' {
  interface Assertion<T = any> {
    toEqualDoc(expected: Store, options?: { compareId?: boolean }): T;
  }
}

const manager = new StoreExtensionManager(getInternalStoreExtensions());
const { notesgraph } = createNotesGraphTemplate(manager.get('store'));

describe('applyPatchToDoc', () => {
  it('should delete a block', async () => {
    const host = notesgraph`
    <notesgraph-page id="page">
      <notesgraph-note id="note">
        <notesgraph-paragraph id="paragraph-1">Hello</notesgraph-paragraph>
        <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
      </notesgraph-note>
    </notesgraph-page>
  `;

    const patch: PatchOp[] = [{ op: 'delete', id: 'paragraph-1' }];
    await applyPatchToDoc(host.store, patch);

    const expected = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    expect(host.store).toEqualDoc(expected.store, {
      compareId: true,
    });
  });

  // FIXME: markdown parse error in test mode
  it.skip('should replace a block', async () => {
    const host = notesgraph`
    <notesgraph-page id="page">
      <notesgraph-note id="note">
        <notesgraph-paragraph id="paragraph-1">Hello</notesgraph-paragraph>
        <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
      </notesgraph-note>
    </notesgraph-page>
  `;

    const patch: PatchOp[] = [
      {
        op: 'replace',
        id: 'paragraph-1',
        content: 'New content',
      },
    ];

    await applyPatchToDoc(host.store, patch);

    const expected = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">New content</notesgraph-paragraph>
          <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    expect(host.store).toEqualDoc(expected.store, {
      compareId: true,
    });
  });

  // FIXME: markdown parse error in test mode
  it.skip('should insert a block at index', async () => {
    const host = notesgraph`
    <notesgraph-page id="page">
      <notesgraph-note id="note">
        <notesgraph-paragraph id="paragraph-1">Hello</notesgraph-paragraph>
        <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
      </notesgraph-note>
    </notesgraph-page>
  `;

    const patch: PatchOp[] = [
      {
        op: 'insert',
        index: 2,
        after: 'paragraph-1',
        block: {
          id: 'paragraph-3',
          type: 'notesgraph:paragraph',
          content: 'Inserted',
        },
      },
    ];

    await applyPatchToDoc(host.store, patch);

    const expected = notesgraph`
      <notesgraph-page id="page">
        <notesgraph-note id="note">
          <notesgraph-paragraph id="paragraph-1">Hello</notesgraph-paragraph>
          <notesgraph-paragraph id="paragraph-2">World</notesgraph-paragraph>
          <notesgraph-paragraph id="paragraph-3">Inserted</notesgraph-paragraph>
        </notesgraph-note>
      </notesgraph-page>
    `;

    expect(host.store).toEqualDoc(expected.store, {
      compareId: true,
    });
  });
});
