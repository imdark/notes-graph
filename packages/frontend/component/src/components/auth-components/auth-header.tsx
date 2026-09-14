import clsx from 'clsx';
import type { FC } from 'react';

import { NotesGraphLogoIcon } from '../brand';
import { authHeaderWrapper } from './share.css';

export const AuthHeader: FC<{
  title: string;
  subTitle?: string;
  className?: string;
}> = ({ title, subTitle, className }) => {
  return (
    <div className={clsx(authHeaderWrapper, className)}>
      <p>
        <NotesGraphLogoIcon className="logo" />
        {title}
      </p>
      <p>{subTitle}</p>
    </div>
  );
};
