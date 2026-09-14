import { DoneIcon } from '@blocksuite/icons/rc';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import { useI18n } from '@notesgraph/i18n';
import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

import { benefits, li } from './benefits.css';

export const BelieverBenefits = ({
  className,
  ...attrs
}: HTMLAttributes<HTMLUListElement>) => {
  const t = useI18n();

  return (
    <ul className={clsx(benefits, className)} {...attrs}>
      <li className={li}>
        <NotesGraphLogoIcon />
        <span>{t['com.notesgraph.payment.lifetime.benefit-1']()}</span>
      </li>

      <li className={li}>
        <DoneIcon />
        <span>{t['com.notesgraph.payment.lifetime.benefit-2']()}</span>
      </li>

      <li className={li}>
        <DoneIcon />
        <span>
          {t['com.notesgraph.payment.lifetime.benefit-3']({
            capacity: '1T',
          })}
        </span>
      </li>
    </ul>
  );
};
