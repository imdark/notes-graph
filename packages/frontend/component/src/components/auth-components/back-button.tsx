import { ArrowLeftSmallIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@notesgraph/i18n';
import type { FC } from 'react';

import type { ButtonProps } from '../../ui/button';
import { Button } from '../../ui/button';

export const BackButton: FC<ButtonProps> = props => {
  const t = useI18n();
  return (
    <Button
      variant="plain"
      style={{
        padding: '2px 8px 2px 0',
      }}
      prefix={<ArrowLeftSmallIcon />}
      {...props}
    >
      {t['com.notesgraph.backButton']()}
    </Button>
  );
};
