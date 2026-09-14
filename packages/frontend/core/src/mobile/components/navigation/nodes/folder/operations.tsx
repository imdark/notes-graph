import { MenuItem } from '@notesgraph/component';
import { IsFavoriteIcon } from '@notesgraph/core/components/pure/icons';
import { CompatibleFavoriteItemsAdapter } from '@notesgraph/core/modules/favorite';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';

export const FavoriteFolderOperation = ({ id }: { id: string }) => {
  const t = useI18n();
  const compatibleFavoriteItemsAdapter = useService(
    CompatibleFavoriteItemsAdapter
  );

  const favorite = useLiveData(
    useMemo(() => {
      return compatibleFavoriteItemsAdapter.isFavorite$(id, 'folder');
    }, [compatibleFavoriteItemsAdapter, id])
  );

  return (
    <MenuItem
      prefixIcon={<IsFavoriteIcon favorite={favorite} />}
      onClick={() => compatibleFavoriteItemsAdapter.toggle(id, 'folder')}
    >
      {favorite
        ? t['com.notesgraph.rootAppSidebar.organize.folder-rm-favorite']()
        : t['com.notesgraph.rootAppSidebar.organize.folder-add-favorite']()}
    </MenuItem>
  );
};
