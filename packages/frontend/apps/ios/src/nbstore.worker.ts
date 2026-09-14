import './setup-worker';

import { type MessageCommunicapable, OpConsumer } from '@notesgraph/infra/op';
import { broadcastChannelStorages } from '@notesgraph/nbstore/broadcast-channel';
import {
  cloudStorages,
  configureSocketAuthMethod,
} from '@notesgraph/nbstore/cloud';
import { idbStoragesIndexerOnly } from '@notesgraph/nbstore/idb';
import {
  bindNativeDBApis,
  type NativeDBApis,
  sqliteStorages,
} from '@notesgraph/nbstore/sqlite';
import {
  StoreManagerConsumer,
  type WorkerManagerOps,
} from '@notesgraph/nbstore/worker/consumer';
import { AsyncCall } from 'async-call-rpc';

import { setEndpointTokenReader } from './proxy';

let authTokenPort: MessagePort | undefined;
const pendingTokenRequests = new Map<string, (token: string | null) => void>();

configureSocketAuthMethod((endpoint, cb) => {
  readEndpointToken(endpoint)
    .then(token => cb(token ? { token, tokenType: 'jwt' } : {}))
    .catch(() => cb({}));
});

// Route fetch/XHR Authorization through the same page bridge the socket auth
// uses — the Capacitor Auth plugin the default reader relies on does not
// exist inside a worker, so without this every worker HTTP request (cloud
// indexer search, static doc/blob fetches) goes out unauthenticated.
setEndpointTokenReader(readEndpointToken);

globalThis.addEventListener('message', e => {
  if (e.data.type === 'native-auth-token-channel') {
    authTokenPort = e.ports[0] as MessagePort;
    authTokenPort.addEventListener('message', e => {
      const { id, token } = e.data as { id?: string; token?: string | null };
      if (!id) return;
      pendingTokenRequests.get(id)?.(token ?? null);
      pendingTokenRequests.delete(id);
    });
    authTokenPort.start();
    return;
  }

  if (e.data.type === 'native-db-api-channel') {
    const port = e.ports[0] as MessagePort;
    const rpc = AsyncCall<NativeDBApis>(
      {},
      {
        channel: {
          on(listener) {
            const f = (e: MessageEvent<any>) => {
              listener(e.data);
            };
            port.addEventListener('message', f);
            return () => {
              port.removeEventListener('message', f);
            };
          },
          send(data) {
            port.postMessage(data);
          },
        },
        // silence per-call request/result console spam (it floods the
        // on-screen debug console and logcat on every native DB op)
        log: false,
      }
    );
    bindNativeDBApis(rpc);
    port.start();
  }
});

function readEndpointToken(endpoint: string) {
  if (!authTokenPort) {
    return Promise.resolve(null);
  }

  const id = `${Date.now()}:${Math.random()}`;
  return new Promise<string | null>(resolve => {
    const timeout = setTimeout(() => {
      pendingTokenRequests.delete(id);
      resolve(null);
    }, 5000);
    pendingTokenRequests.set(id, token => {
      clearTimeout(timeout);
      resolve(token);
    });
    authTokenPort?.postMessage({ id, endpoint });
  });
}

const consumer = new OpConsumer<WorkerManagerOps>(
  globalThis as MessageCommunicapable
);

const storeManager = new StoreManagerConsumer([
  ...idbStoragesIndexerOnly,
  ...sqliteStorages,
  ...broadcastChannelStorages,
  ...cloudStorages,
]);

storeManager.bindConsumer(consumer);
