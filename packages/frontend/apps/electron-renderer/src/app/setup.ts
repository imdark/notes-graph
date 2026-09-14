import '@notesgraph/core/bootstrap/electron';
import '@notesgraph/core/bootstrap/cleanup';
import '@notesgraph/component/theme';
import './global.css';

import { apis } from '@notesgraph/electron-api';
import { bindNativeDBApis } from '@notesgraph/nbstore/sqlite';
import { bindNativeDBV1Apis } from '@notesgraph/nbstore/sqlite/v1';

// oxlint-disable-next-line no-non-null-assertion
bindNativeDBApis(apis!.nbstore);
// oxlint-disable-next-line no-non-null-assertion
bindNativeDBV1Apis(apis!.db);
