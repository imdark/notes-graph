import { createEvent } from '@notesgraph/infra';

import type { AuthAccountInfo } from '../entities/session';

export const AccountLoggedOut =
  createEvent<AuthAccountInfo>('AccountLoggedOut');
