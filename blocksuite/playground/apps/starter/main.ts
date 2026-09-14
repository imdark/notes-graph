import '../../style.css';

import * as editor from '@blocksuite/integration-test';
import { effects as itEffects } from '@blocksuite/integration-test/effects';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import * as databaseBlocks from '@blocksuite/notesgraph/blocks/database';
import * as noteBlocks from '@blocksuite/notesgraph/blocks/note';
import * as globalUtils from '@blocksuite/notesgraph/global/utils';
import * as services from '@blocksuite/notesgraph/shared/services';
import * as blockStd from '@blocksuite/notesgraph/std';
import * as store from '@blocksuite/notesgraph/store';
import * as notesgraphModel from '@blocksuite/notesgraph-model';

import { setupEdgelessTemplate } from '../_common/setup.js';
import { effects as commentEffects } from '../comment/effects.js';
import {
  createStarterDocCollection,
  initStarterDocCollection,
} from './utils/collection.js';
import { mountDefaultDocEditor } from './utils/setup-playground';
import { prepareTestApp } from './utils/test';

itEffects();
const storeManager = getTestStoreManager();
commentEffects();

async function main() {
  if (window.collection) return;

  setupEdgelessTemplate();

  const params = new URLSearchParams(location.search);
  const room = params.get('room') ?? Math.random().toString(16).slice(2, 8);
  const isE2E = room.startsWith('playwright');
  const collection = createStarterDocCollection(storeManager);

  if (isE2E) {
    Object.defineProperty(window, '$blocksuite', {
      value: Object.freeze({
        store,
        blocks: {
          database: databaseBlocks,
          note: noteBlocks,
        },
        global: { utils: globalUtils },
        services,
        editor,
        blockStd: blockStd,
        notesgraphModel: notesgraphModel,
      }),
    });
    await prepareTestApp(collection);

    return;
  }

  await initStarterDocCollection(collection);
  await mountDefaultDocEditor(collection);
}

main().catch(console.error);
