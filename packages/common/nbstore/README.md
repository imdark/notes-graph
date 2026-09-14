# Space Storage

## Usage

### Independent Storage usage

```ts
import type { ConnectionStatus } from '@notesgraph/nbstore';
import { IndexedDBDocStorage } from '@notesgraph/nbstore/idb';

const storage = new IndexedDBDocStorage({
  peer: 'local'
  spaceId: 'my-new-workspace',
});

await storage.connect();
storage.connection.onStatusChange((status: ConnectionStatus, error?: Error) => {
  ui.show(status, error);
});

// { docId: string, bin: Uint8Array, timestamp: Date, editor?: string } | null
const doc = await storage.getDoc('my-first-doc');
```

### Use All storages together

```ts
import { SpaceStorage } from '@notesgraph/nbstore';
import type { ConnectionStatus } from '@notesgraph/nbstore';
import { IndexedDBDocStorage } from '@notesgraph/nbstore/idb';
import { SqliteBlobStorage } from '@notesgraph/nbstore/sqlite';

const storage = new SpaceStorage([new IndexedDBDocStorage({}), new SqliteBlobStorage({})]);

await storage.connect();
storage.on('connection', ({ storage, status, error }) => {
  ui.show(storage, status, error);
});

await storage.get('doc').pushDocUpdate({ docId: 'my-first-doc', bin: new Uint8Array(), editor: 'me' });
await storage.tryGet('blob')?.get('img');
```

### Put Storage behind Worker

```ts
import { SpaceStorageWorkerClient } from '@notesgraph/nbstore/op';
import type { ConnectionStatus } from '@notesgraph/nbstore';
import { IndexedDBDocStorage } from '@notesgraph/nbstore/idb';

const client = new SpaceStorageWorkerClient();
client.addStorage(IndexedDBDocStorage, {
  // options can only be structure-cloneable type
  peer: 'local',
  spaceType: 'workspace',
  spaceId: 'my-new-workspace',
});

await client.connect();
client.ob$('connection', ({ storage, status, error }) => {
  ui.show(storage, status, error);
});

await client.call('pushDocUpdate', { docId: 'my-first-doc', bin: new Uint8Array(), editor: 'me' });

// call unregistered op will leads to Error
// Error { message: 'Handler for operation [listHistory] is not registered.' }
await client.call('listHistories', { docId: 'my-first-doc' });
```
