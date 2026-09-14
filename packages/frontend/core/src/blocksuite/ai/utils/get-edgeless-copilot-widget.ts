import type { EditorHost } from '@blocksuite/notesgraph/std';

import type { EdgelessCopilotWidget } from '../widgets/edgeless-copilot';
import { NOTESGRAPH_EDGELESS_COPILOT_WIDGET } from '../widgets/edgeless-copilot/constant';

export function getEdgelessCopilotWidget(
  host: EditorHost
): EdgelessCopilotWidget {
  const rootBlockId = host.store.root?.id as string;
  const copilotWidget = host.view.getWidget(
    NOTESGRAPH_EDGELESS_COPILOT_WIDGET,
    rootBlockId
  ) as EdgelessCopilotWidget;

  return copilotWidget;
}
