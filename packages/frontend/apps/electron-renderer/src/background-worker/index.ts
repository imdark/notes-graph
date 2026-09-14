import '@notesgraph/core/bootstrap/electron';

import { apis } from '@notesgraph/electron-api';
import { OpConsumer } from '@notesgraph/infra/op';
import { broadcastChannelStorages } from '@notesgraph/nbstore/broadcast-channel';
import {
  cloudStorages,
  configureSocketAuthMethod,
} from '@notesgraph/nbstore/cloud';
import { bindNativeDBApis, sqliteStorages } from '@notesgraph/nbstore/sqlite';
import {
  bindNativeDBV1Apis,
  sqliteV1Storages,
} from '@notesgraph/nbstore/sqlite/v1';
import {
  StoreManagerConsumer,
  type WorkerManagerOps,
} from '@notesgraph/nbstore/worker/consumer';

// oxlint-disable-next-line no-non-null-assertion
bindNativeDBApis(apis!.nbstore);
// oxlint-disable-next-line no-non-null-assertion
bindNativeDBV1Apis(apis!.db);
configureSocketAuthMethod((endpoint, cb) => {
  // oxlint-disable-next-line no-non-null-assertion
  apis!.auth
    .readEndpointToken(endpoint)
    .then(({ token }: { token?: string | null }) => {
      cb(token ? { token, tokenType: 'jwt' } : {});
    })
    .catch(() => cb({}));
});

const storeManager = new StoreManagerConsumer([
  ...sqliteStorages,
  ...sqliteV1Storages,
  ...broadcastChannelStorages,
  ...cloudStorages,
]);

window.addEventListener('message', ev => {
  if (ev.data.type === 'electron:worker-connect') {
    const port = ev.ports[0];

    const consumer = new OpConsumer<WorkerManagerOps>(port);
    storeManager.bindConsumer(consumer);
  }
});
