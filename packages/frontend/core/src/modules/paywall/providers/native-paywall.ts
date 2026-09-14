import { createIdentifier } from '@notesgraph/infra';

export interface NativePaywallProvider {
  showPaywall(type: 'Pro' | 'AI'): Promise<void>;
}

export const NativePaywallProvider = createIdentifier<NativePaywallProvider>(
  'NativePaywallProvider'
);
