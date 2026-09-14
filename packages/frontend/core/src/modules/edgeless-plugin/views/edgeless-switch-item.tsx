import { Tooltip } from '@notesgraph/component';
import { InternalLottie } from '@notesgraph/component/internal-lottie';
import {
  HoverAnimateController,
  type HoverAnimateControllerProps,
} from '@notesgraph/core/blocksuite/block-suite-mode-switch/switch-items';
import { useI18n } from '@notesgraph/i18n';

import edgelessHover from './edgeless-hover.json';

const edgelessLottieOptions = {
  loop: false,
  autoplay: false,
  animationData: edgelessHover,
  rendererSettings: {
    preserveAspectRatio: 'xMidYMid slice',
  },
};

/** The edgeless mode's toggle item (Lottie hover icon), contributed by the plugin. */
export const EdgelessSwitchItem = (
  props: Omit<HoverAnimateControllerProps, 'children'>
) => {
  const t = useI18n();
  return (
    <Tooltip
      content={t['com.notesgraph.header.mode-switch.edgeless']()}
      shortcut={['$alt', 'S']}
      side="bottom"
    >
      <HoverAnimateController {...props}>
        <InternalLottie options={edgelessLottieOptions} />
      </HoverAnimateController>
    </Tooltip>
  );
};
