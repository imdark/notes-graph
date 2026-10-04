import { registerPlugin } from '@capacitor/core';

import type { AgentPushPlugin } from './definitions';

const AgentPush = registerPlugin<AgentPushPlugin>('AgentPush');

export * from './definitions';
export { AgentPush };
