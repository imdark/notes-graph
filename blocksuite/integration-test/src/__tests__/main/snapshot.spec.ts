import type { PointLocation } from '@blocksuite/global/gfx';
import type { SurfaceBlockModel } from '@blocksuite/notesgraph/blocks/surface';
import { NotesGraphSchemas } from '@blocksuite/notesgraph/schemas';
import { ZipTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
import { Schema } from '@blocksuite/store';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { setupEditor } from '../utils/setup.js';

const excludes = new Set([
  'shape-textBound',
  'externalXYWH',
  'connector-text',
  'connector-labelXYWH',
]);

const fieldChecker: Record<string, (value: any) => boolean> = {
  'connector-path': (value: PointLocation[]) => {
    return value.length > 0;
  },
  xywh: (value: string) => {
    return value.match(xywhPattern) !== null;
  },
};

const skipFields = new Set(['_lastXYWH']);

/**
 * The snapshots were exported by AFFiNE, before the blocks and theme
 * variables were renamed: rename them in the snapshots' JSON before import.
 */
const fetchRenamedSnapshot = async (snapshotUrl: string) => {
  const zipped = new Uint8Array(await (await fetch(snapshotUrl)).arrayBuffer());
  const files = unzipSync(zipped);
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('.json')) continue;
    files[name] = strToU8(
      strFromU8(data)
        .replaceAll('"affine:', '"notesgraph:')
        .replaceAll('--affine-', '--notesgraph-')
    );
  }
  return new Blob([zipSync(files)], { type: 'application/zip' });
};

const snapshotTest = async (snapshotUrl: string, elementsCount: number) => {
  const transformer = ZipTransformer;
  const schema = new Schema();
  schema.register(NotesGraphSchemas);

  const snapshotFile = await fetchRenamedSnapshot(snapshotUrl).catch(e => {
    console.error(e);
    throw e;
  });

  const [newDoc] = await transformer.importDocs(
    window.editor.doc.workspace,
    schema,
    snapshotFile
  );

  if (!newDoc) {
    throw new Error('Failed to import snapshot');
  }

  editor.doc = newDoc;
  await wait();

  const surface = newDoc.getModelsByFlavour(
    'notesgraph:surface'
  )[0] as SurfaceBlockModel;
  const surfaceElements = [...surface['_elementModels']].map(
    ([_, { model }]) => model
  );

  expect(surfaceElements.length).toBe(elementsCount);

  surfaceElements.forEach(element => {
    const type = element.type;

    for (const field in element) {
      const value = element[field as keyof typeof element];
      const typeField = `${type}-${field}`;

      if (excludes.has(`${type}-${field}`) || excludes.has(field)) {
        return;
      }

      if (skipFields.has(field)) {
        return;
      }

      if (fieldChecker[typeField] || fieldChecker[field]) {
        const checker = fieldChecker[typeField] || fieldChecker[field];
        expect(checker(value)).toBe(true);
        return;
      }

      expect(
        value,
        `type: ${element.type} field: "${field}"`
      ).not.toBeUndefined();
      expect(value, `type: ${element.type} field: "${field}"`).not.toBeNull();
      expect(value, `type: ${element.type} field: "${field}"`).not.toBeNaN();
    }
  });
};

beforeEach(async () => {
  const cleanup = await setupEditor('page');

  return cleanup;
});

const xywhPattern = /\[(\s*-?\d+(\.\d+)?\s*,){3}(\s*-?\d+(\.\d+)?\s*)\]/;

// Downloads: the second snapshot is 13 MB.
const SNAPSHOT_TIMEOUT_MS = 60_000;

test(
  'snapshot 1 importing',
  async () => {
    await snapshotTest(
      'https://test.affineassets.com/test-snapshot-1.zip',
      25
    );
  },
  SNAPSHOT_TIMEOUT_MS
);

test(
  'snapshot 2 importing',
  async () => {
    await snapshotTest(
      'https://test.affineassets.com/test-snapshot-2%20(onboarding).zip',
      174
    );
  },
  SNAPSHOT_TIMEOUT_MS
);
