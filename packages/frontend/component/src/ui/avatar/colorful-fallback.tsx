import clsx from 'clsx';
import { useMemo, useState } from 'react';

import {
  DefaultAvatarContainerStyle,
  DefaultAvatarRingStyle,
  DefaultAvatarRingWithAnimationStyle,
  DefaultAvatarSheenStyle,
} from './style.css';

const colorsSchema = [
  ['#FF0000', '#FF00E5', '#FFAE73'],
  ['#FF5C00', '#FFC700', '#FFE073'],
  ['#FFDA16', '#FFFBA6', '#FFBE73'],
  ['#8CD317', '#FCFF5C', '#67CAE9'],
  ['#28E19F', '#89FFC6', '#39A880'],
  ['#35B7E0', '#77FFCE', '#5076FF'],
  ['#3D39FF', '#77BEFF', '#3502FF'],
  ['#BD08EB', '#755FFF', '#6967E4'],
];

/**
 * The generated workspace/user avatar: a distinctive **circular** blend of a
 * per-name colour triplet (a conic gradient), rather than the old linear
 * stack of blurred bars. The starting angle is also derived from the name so
 * two workspaces sharing a palette still look different. Slowly rotates on
 * hover.
 */
export const ColorfulFallback = ({ char }: { char: string }) => {
  const { gradient } = useMemo(() => {
    const code = char.toUpperCase().charCodeAt(0) || 0;
    const [a, b, c] = colorsSchema[code % colorsSchema.length];
    const angle = (code * 47) % 360;
    return {
      gradient: `conic-gradient(from ${angle}deg, ${a}, ${b}, ${c}, ${a})`,
    };
  }, [char]);

  const [isHover, setIsHover] = useState(false);

  return (
    <div
      className={DefaultAvatarContainerStyle}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <div
        className={clsx(DefaultAvatarRingStyle, {
          [DefaultAvatarRingWithAnimationStyle]: isHover,
        })}
        style={{ background: gradient }}
      />
      <div className={DefaultAvatarSheenStyle} />
    </div>
  );
};
export default ColorfulFallback;
