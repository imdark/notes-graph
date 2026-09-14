# Routes

## Usage

### Path Factories

```ts
import { FACTORIES } from '@notesgraph/routes';

const path = FACTORIES.workspace.doc({ workspaceId: '123', docId: '456' });
//                                     ^^^^ with typecheck
```

### Register router

```tsx
import { ROUTES } from '@notesgraph/routes';

function Routes() {
  return <Router path={ROUTES.admin.index} element={} />;
}
```

### Path Parameter

```ts
import { RouteParamsTypes } from '@notesgraph/routes';

function Doc() {
  const { workspaceId, docId } = useParams<RouteParamsTypes['workspace']['doc']>();
}

function Attachment() {
  const { workspaceId, docId, attachmentId } = useParams<RouteParamsTypes['workspace']['doc']['attachment']>();
}
```
