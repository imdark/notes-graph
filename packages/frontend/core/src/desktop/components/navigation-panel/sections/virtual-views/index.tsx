import {
  ChatPanelIcon,
  EmailIcon,
  FileIconRssIcon,
  FolderIcon,
  GoogleIcon,
  PlusIcon,
  TagsIcon,
  YoutubeIcon,
} from '@blocksuite/icons/rc';
import { IconButton, Menu, MenuItem, notify } from '@notesgraph/component';
import { RenameModal } from '@notesgraph/component/rename-modal';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { VirtualViewsService } from '@notesgraph/core/modules/virtual-views';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelVirtualViewNode } from '../../nodes/virtual-view';
import { NavigationPanelTreeRoot } from '../../tree';
import { EmailAddModal } from './email-add-modal';
import { TrackerAddModal } from './tracker-add-modal';

export const NavigationPanelVirtualViews = () => {
  const t = useI18n();
  const { virtualViewsService, navigationPanelService } = useServices({
    VirtualViewsService,
    NavigationPanelService,
  });
  const path = useMemo(() => ['virtual-views'], []);
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  // Which source type we're adding, or null when not adding.
  const [addingType, setAddingType] = useState<
    'youtube' | 'rss' | 'slack' | null
  >(null);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<
    'imap' | 'gmail' | 'gdrive' | null
  >(null);
  const views = useLiveData(virtualViewsService.views.views$);

  const handleAdd = useCallback(
    (input: string) => {
      const type = addingType;
      if (!type || !input.trim()) return;
      virtualViewsService.addView(type, input.trim()).catch(error => {
        console.error(error);
        notify.error({
          title: t['com.notesgraph.virtualViews.add-error'](),
          message: error instanceof Error ? error.message : undefined,
        });
      });
      navigationPanelService.setCollapsed(path, false);
    },
    [addingType, navigationPanelService, path, t, virtualViewsService]
  );

  useEffect(() => {
    if (collapsed) setAddingType(null);
  }, [collapsed]);

  // Keep channels fresh: crawl any view not synced recently when the sidebar
  // section first mounts (the "live" part).
  useEffect(() => {
    virtualViewsService.refreshStale().catch(console.error);
  }, [virtualViewsService]);

  return (
    <CollapsibleSection
      path={path}
      testId="navigation-panel-virtual-views"
      title={t['com.notesgraph.virtualViews.title']()}
      actions={
        <>
          <Menu
            items={
              <>
                <MenuItem
                  prefixIcon={<YoutubeIcon />}
                  onClick={() => setAddingType('youtube')}
                >
                  {t['com.notesgraph.virtualViews.add-youtube']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<FileIconRssIcon />}
                  onClick={() => setAddingType('rss')}
                >
                  {t['com.notesgraph.virtualViews.add-rss']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<ChatPanelIcon />}
                  onClick={() => setAddingType('slack')}
                >
                  {t['com.notesgraph.virtualViews.add-slack']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<TagsIcon />}
                  onClick={() => setTrackerOpen(true)}
                >
                  {t['com.notesgraph.virtualViews.add-tracker']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<EmailIcon />}
                  onClick={() => setEmailMode('imap')}
                >
                  {t['com.notesgraph.virtualViews.add-imap']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<GoogleIcon />}
                  onClick={() => setEmailMode('gmail')}
                >
                  {t['com.notesgraph.virtualViews.add-gmail']()}
                </MenuItem>
                <MenuItem
                  prefixIcon={<FolderIcon />}
                  onClick={() => setEmailMode('gdrive')}
                >
                  {t['com.notesgraph.virtualViews.add-gdrive']()}
                </MenuItem>
              </>
            }
          >
            <IconButton
              data-testid="navigation-panel-bar-add-virtual-view-button"
              size="16"
              tooltip={t['com.notesgraph.virtualViews.add-tooltip']()}
            >
              <PlusIcon />
            </IconButton>
          </Menu>
          {addingType && (
            <RenameModal
              open
              onOpenChange={open => {
                if (!open) setAddingType(null);
              }}
              onRename={handleAdd}
              currentName=""
            />
          )}
          <TrackerAddModal open={trackerOpen} onOpenChange={setTrackerOpen} />
          {emailMode && (
            <EmailAddModal
              mode={emailMode}
              open
              onOpenChange={open => {
                if (!open) setEmailMode(null);
              }}
            />
          )}
        </>
      }
    >
      <NavigationPanelTreeRoot
        placeholder={
          <div style={{ fontSize: 12, opacity: 0.6, padding: '4px 8px' }}>
            {t['com.notesgraph.virtualViews.empty']()}
          </div>
        }
      >
        {(views ?? []).map(view => (
          <NavigationPanelVirtualViewNode
            key={view.id}
            viewId={view.id}
            reorderable={false}
            parentPath={path}
          />
        ))}
      </NavigationPanelTreeRoot>
    </CollapsibleSection>
  );
};
