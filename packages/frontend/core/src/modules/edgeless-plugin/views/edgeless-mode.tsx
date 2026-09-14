import { NewXxxEdgelessIcon } from '@blocksuite/icons/lit';
import { EdgelessIcon } from '@blocksuite/icons/rc';
import { getEdgelessViewExtensions } from '@blocksuite/notesgraph/extensions/edgeless-view';
import type { DocModeContribution } from '@notesgraph/plugin-sdk/client';
import { createElement } from 'react';

import { BlocksuiteEdgelessEditor } from './edgeless-editor';
import { EdgelessSwitchItem } from './edgeless-switch-item';

/**
 * Assemble the edgeless doc-mode descriptor. Imported dynamically on plugin
 * activation so the gfx/edgeless module graph (view extensions + the edgeless
 * editor shell + lit custom-element effects) only loads once enabled.
 */
export function createEdgelessDocMode(): DocModeContribution {
  return {
    id: 'edgeless',
    labelKey: 'Edgeless',
    icon: EdgelessIcon,
    toggleItem: createElement(EdgelessSwitchItem),
    creationIcon: () => NewXxxEdgelessIcon(),
    creatable: true,
    order: 1,
    editor: BlocksuiteEdgelessEditor,
    viewExtensions: getEdgelessViewExtensions(),
  };
}
