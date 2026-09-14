import { PlusIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@notesgraph/component';
import { ExplorerNavigation } from '@notesgraph/core/components/explorer/header/navigation';
import { Header } from '@notesgraph/core/components/pure/header';
import clsx from 'clsx';

import * as styles from './header.css';

export const AllCollectionHeader = ({
  showCreateNew,
  onCreateCollection,
}: {
  showCreateNew: boolean;
  onCreateCollection?: () => void;
}) => {
  return (
    <Header
      right={
        <IconButton
          size="16"
          icon={<PlusIcon />}
          onClick={onCreateCollection}
          className={clsx(
            styles.headerCreateNewCollectionIconButton,
            !showCreateNew && styles.headerCreateNewButtonHidden
          )}
        />
      }
      left={<ExplorerNavigation active={'collections'} />}
    />
  );
};
