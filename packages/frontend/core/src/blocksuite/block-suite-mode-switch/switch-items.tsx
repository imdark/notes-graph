import { Tooltip } from '@notesgraph/component';
import {
  type CustomLottieProps,
  InternalLottie,
} from '@notesgraph/component/internal-lottie';
import { useI18n } from '@notesgraph/i18n';
import type { HTMLAttributes } from 'react';
import type React from 'react';
import { cloneElement, useState } from 'react';

import pageHover from './animation-data/page-hover.json';

export type HoverAnimateControllerProps = {
  active?: boolean;
  hide?: boolean;
  trash?: boolean;
  children: React.ReactElement<CustomLottieProps>;
} & HTMLAttributes<HTMLDivElement>;

/**
 * Generic hover-to-play wrapper for a mode switch item's Lottie icon. Exported
 * so doc-mode plugins (e.g. edgeless) can build their own switch item.
 */
export const HoverAnimateController = ({
  children,
  ...props
}: HoverAnimateControllerProps) => {
  const [startAnimate, setStartAnimate] = useState(false);
  return (
    <div
      onMouseEnter={() => setStartAnimate(true)}
      onMouseLeave={() => setStartAnimate(false)}
      {...props}
    >
      {cloneElement(children, {
        isStopped: !startAnimate,
        speed: 1,
        width: 20,
        height: 20,
      })}
    </div>
  );
};

const pageLottieOptions = {
  loop: false,
  autoplay: false,
  animationData: pageHover,
  rendererSettings: {
    preserveAspectRatio: 'xMidYMid slice',
  },
};

export const PageSwitchItem = (
  props: Omit<HoverAnimateControllerProps, 'children'>
) => {
  const t = useI18n();
  return (
    <Tooltip
      content={t['com.notesgraph.header.mode-switch.page']()}
      shortcut={['$alt', 'S']}
      side="bottom"
    >
      <HoverAnimateController {...props}>
        <InternalLottie options={pageLottieOptions} />
      </HoverAnimateController>
    </Tooltip>
  );
};
