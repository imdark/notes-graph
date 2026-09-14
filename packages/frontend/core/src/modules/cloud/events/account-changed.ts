import { createEvent } from '@notesgraph/infra';

import type { AuthAccountInfo } from '../entities/session';

export const AccountChanged = createEvent<AuthAccountInfo | null>(
  'AccountChanged'
);
