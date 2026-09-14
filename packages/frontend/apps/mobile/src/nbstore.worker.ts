import '@notesgraph/core/bootstrap/browser';

import { type MessageCommunicapable, OpConsumer } from '@notesgraph/infra/op';
import { broadcastChannelStorages } from '@notesgraph/nbstore/broadcast-channel';
import { cloudStorages } from '@notesgraph/nbstore/cloud';
import { idbStorages } from '@notesgraph/nbstore/idb';
import { idbV1Storages } from '@notesgraph/nbstore/idb/v1';
import {
  StoreManagerConsumer,
  type WorkerManagerOps,
} from '@notesgraph/nbstore/worker/consumer';

const consumer = new StoreManagerConsumer([
  ...idbStorages,
  ...idbV1Storages,
  ...broadcastChannelStorages,
  ...cloudStorages,
]);

if ('onconnect' in globalThis) {
  // if in shared worker

  (globalThis as any).onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    consumer.bindConsumer(new OpConsumer<WorkerManagerOps>(port));
  };
} else {
  // if in worker
  consumer.bindConsumer(
    new OpConsumer<WorkerManagerOps>(globalThis as MessageCommunicapable)
  );
}
