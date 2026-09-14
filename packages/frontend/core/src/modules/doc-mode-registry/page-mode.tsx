import { NewXxxPageIcon } from '@blocksuite/icons/lit';
import { PageIcon } from '@blocksuite/icons/rc';

import { PageSwitchItem } from '../../blocksuite/block-suite-mode-switch/switch-items';
import type { DocModeDescriptor } from './types';

/**
 * The built-in "page" doc mode. Always present in the registry; its editor is
 * left undefined so consumers fall back to the default page editor.
 */
export const pageDocMode: DocModeDescriptor = {
  id: 'page',
  labelKey: 'Page',
  icon: PageIcon,
  toggleItem: <PageSwitchItem />,
  creationIcon: () => NewXxxPageIcon(),
  creatable: true,
  order: 0,
};
