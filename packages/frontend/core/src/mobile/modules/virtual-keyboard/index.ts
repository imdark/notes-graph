import type { Framework } from '@notesgraph/infra';

import { VirtualKeyboardProvider } from './providers/virtual-keyboard';
import { VirtualKeyboardService } from './services/virtual-keyboard';

export { VirtualKeyboardProvider, VirtualKeyboardService };
export { createKeyboardChanges, type KeyboardChange } from './keyboard-changes';

export function configureMobileVirtualKeyboardModule(framework: Framework) {
  framework.service(VirtualKeyboardService, [VirtualKeyboardProvider]);
}
