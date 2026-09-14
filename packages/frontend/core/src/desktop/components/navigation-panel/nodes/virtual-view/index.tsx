import {
  ChatPanelIcon,
  DeleteIcon,
  EmailIcon,
  FileIconRssIcon,
  FolderIcon,
  GoogleIcon,
  LinkIcon,
  PlayIcon,
  ResetIcon,
  TagsIcon,
  YoutubeIcon,
} from '@blocksuite/icons/rc';
import { MenuItem, MenuSeparator, toast } from '@notesgraph/component';
import { RenameModal } from '@notesgraph/component/rename-modal';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { UrlService } from '@notesgraph/core/modules/url';
import { VirtualViewsService } from '@notesgraph/core/modules/virtual-views';
import { useI18n } from '@notesgraph/i18n';
import {
  LiveData,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { NavigationPanelTreeNode } from '../../tree';
import type { NodeOperation } from '../../tree/types';
import type { GenericNavigationPanelNode } from '../types';

const typeIcon: Record<string, typeof YoutubeIcon> = {
  youtube: YoutubeIcon,
  rss: FileIconRssIcon,
  slack: ChatPanelIcon,
  tracker: TagsIcon,
  imap: EmailIcon,
  gmail: GoogleIcon,
  gdrive: FolderIcon,
};

const itemIcon: Record<string, typeof PlayIcon> = {
  youtube: PlayIcon,
  rss: LinkIcon,
  slack: ChatPanelIcon,
  tracker: TagsIcon,
  imap: EmailIcon,
  gmail: EmailIcon,
  gdrive: LinkIcon,
};

export const NavigationPanelVirtualViewNode = ({
  viewId,
  reorderable,
  parentPath,
}: {
  viewId: string;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const { virtualViewsService, urlService } = useServices({
    VirtualViewsService,
    UrlService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  const [renaming, setRenaming] = useState(false);

  const views = useLiveData(virtualViewsService.views.views$);
  const view = useMemo(
    () => views?.find(v => v.id === viewId),
    [views, viewId]
  );
  const items = useLiveData(
    useMemo(
      () => LiveData.from(virtualViewsService.watchItems(viewId), []),
      [virtualViewsService, viewId]
    )
  );
  const dataPoints = useLiveData(
    useMemo(
      () => LiveData.from(virtualViewsService.watchDataPoints(viewId), []),
      [virtualViewsService, viewId]
    )
  );
  const crawling = useLiveData(virtualViewsService.crawling$);
  const isCrawling = crawling.has(viewId);

  const path = useMemo(
    () => [...(parentPath ?? []), `virtual-view-${viewId}`],
    [parentPath, viewId]
  );
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => navigationPanelService.setCollapsed(path, value),
    [navigationPanelService, path]
  );

  const handleRefresh = useCallback(() => {
    virtualViewsService.crawl(viewId).catch(console.error);
  }, [viewId, virtualViewsService]);

  const handleRename = useCallback(
    (name: string) => virtualViewsService.renameView(viewId, name),
    [viewId, virtualViewsService]
  );

  const handleDelete = useCallback(() => {
    virtualViewsService.deleteView(viewId);
    toast(t['com.notesgraph.virtualViews.removed']());
  }, [viewId, virtualViewsService, t]);

  const operations = useMemo<NodeOperation[]>(
    () => [
      {
        index: 40,
        view: (
          <MenuItem prefixIcon={<ResetIcon />} onClick={handleRefresh}>
            {t['com.notesgraph.virtualViews.refresh']()}
          </MenuItem>
        ),
      },
      {
        index: 50,
        view: (
          <MenuItem onClick={() => setRenaming(true)}>{t['Rename']()}</MenuItem>
        ),
      },
      { index: 9999, view: <MenuSeparator key="sep" /> },
      {
        index: 10000,
        view: (
          <MenuItem
            type="danger"
            prefixIcon={<DeleteIcon />}
            onClick={handleDelete}
          >
            {t['Delete']()}
          </MenuItem>
        ),
      },
    ],
    [handleDelete, handleRefresh, t]
  );

  if (!view) {
    return null;
  }

  const Icon = typeIcon[view.type] ?? LinkIcon;
  const ItemIcon = itemIcon[view.type] ?? LinkIcon;

  const isTracker = view.type === 'tracker';
  const unit = typeof view.config.unit === 'string' ? view.config.unit : '';
  const sourceUrl =
    typeof view.config.url === 'string' ? view.config.url : '';
  const latest = dataPoints.at(-1);
  const previous = dataPoints.at(-2);
  const trend =
    latest && previous
      ? latest.value > previous.value
        ? ' ▲'
        : latest.value < previous.value
          ? ' ▼'
          : ''
      : '';

  return (
    <NavigationPanelTreeNode
      icon={Icon}
      name={view.name}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      reorderable={reorderable}
      operations={operations}
      postfix={
        isCrawling ? (
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {t['com.notesgraph.virtualViews.crawling']()}
          </span>
        ) : isTracker && latest ? (
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {unit}
            {latest.value}
            {trend}
          </span>
        ) : null
      }
      data-testid={`navigation-panel-virtual-view-${viewId}`}
    >
      {renaming && (
        <RenameModal
          open
          onOpenChange={setRenaming}
          onRename={handleRename}
          currentName={view.name}
        />
      )}
      {isTracker
        ? [...dataPoints]
            .reverse()
            .slice(0, 30)
            .map(point => (
              <NavigationPanelTreeNode
                key={point.id}
                icon={ItemIcon}
                name={`${unit}${point.value} · ${new Date(
                  point.at
                ).toLocaleDateString()}`}
                collapsed
                setCollapsed={() => {}}
                collapsible={false}
                reorderable={false}
                onClick={() =>
                  sourceUrl && urlService.openPopupWindow(sourceUrl)
                }
                data-testid={`virtual-datapoint-${point.id}`}
              />
            ))
        : (items ?? []).map(item => (
            <NavigationPanelTreeNode
              key={item.id}
              icon={ItemIcon}
              name={item.title}
              collapsed
              setCollapsed={() => {}}
              collapsible={false}
              reorderable={false}
              onClick={() =>
                item.url && urlService.openPopupWindow(item.url)
              }
              data-testid={`virtual-item-${item.id}`}
            />
          ))}
    </NavigationPanelTreeNode>
  );
};
