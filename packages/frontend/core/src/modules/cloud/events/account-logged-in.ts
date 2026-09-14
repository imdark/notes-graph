import { createEvent } from '@notesgraph/infra';

import type { AuthAccountInfo } from '../entities/session';

export const AccountLoggedIn = createEvent<AuthAccountInfo>('AccountLoggedIn');
