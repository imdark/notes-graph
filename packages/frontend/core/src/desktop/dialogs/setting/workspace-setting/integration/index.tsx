import { SettingHeader } from '@notesgraph/component/setting-components';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  CALENDAR_INTEGRATION_SCROLL_ANCHOR,
  GOOGLE_WORKSPACE_INTEGRATION_SCROLL_ANCHOR,
} from '../../navigation-constants';
import { SubPageProvider, useSubPageIsland } from '../../sub-page';
import {
  IntegrationCard,
  IntegrationCardContent,
  IntegrationCardHeader,
} from './card';
import { getAllowedIntegrationList } from './constants';
import { type IntegrationItem } from './constants';
import { list } from './index.css';

export const IntegrationSetting = ({
  scrollAnchor,
}: {
  scrollAnchor?: string;
}) => {
  const t = useI18n();
  const [opened, setOpened] = useState<string | null>(null);
  const workspaceService = useService(WorkspaceService);
  const info = useWorkspaceInfo(workspaceService.workspace);
  const isCloudWorkspace = workspaceService.workspace.flavour !== 'local';
  const isWorkspaceAdmin = !!(info?.isOwner || info?.isAdmin);
  const showByok = isCloudWorkspace && isWorkspaceAdmin;

  const integrationList = useMemo(
    () =>
      getAllowedIntegrationList(isCloudWorkspace, showByok, isWorkspaceAdmin),
    [isCloudWorkspace, showByok, isWorkspaceAdmin]
  );

  useEffect(() => {
    const anchorToItemId: Record<string, IntegrationItem['id']> = {
      [CALENDAR_INTEGRATION_SCROLL_ANCHOR]: 'calendar',
      [GOOGLE_WORKSPACE_INTEGRATION_SCROLL_ANCHOR]: 'google-workspace',
    };
    const itemId = scrollAnchor ? anchorToItemId[scrollAnchor] : undefined;
    if (!itemId) {
      return;
    }

    const hasSetting = integrationList.some(
      item => item.id === itemId && 'setting' in item
    );
    if (hasSetting) {
      setOpened(itemId);
    }
  }, [integrationList, scrollAnchor]);

  const handleCardClick = useCallback((card: IntegrationItem) => {
    if ('setting' in card && card.setting) {
      setOpened(card.id);
    }
  }, []);

  return (
    <>
      <SettingHeader
        title={t['com.notesgraph.integration.integrations']()}
        subtitle={
          <>
            {t['com.notesgraph.integration.setting.description']()}
            {/* <br /> */}
            {/* <a>{t['Learn how to develop a integration for NotesGraph']()}</a> */}
          </>
        }
      />
      <ul className={list}>
        {integrationList.map(item => {
          const title =
            typeof item.name === 'string'
              ? t[item.name]()
              : t[item.name.i18nKey]();
          const desc =
            typeof item.desc === 'string'
              ? t[item.desc]()
              : t[item.desc.i18nKey]();
          return (
            <li key={item.id}>
              <IntegrationCard
                onClick={() => handleCardClick(item)}
                link={'link' in item ? item.link : undefined}
              >
                <IntegrationCardHeader icon={item.icon} title={title} />
                <IntegrationCardContent desc={desc} />
              </IntegrationCard>

              {'setting' in item && item.setting ? (
                <IntegrationSettingPage
                  open={opened === item.id}
                  onClose={() => setOpened(null)}
                >
                  {item.setting}
                </IntegrationSettingPage>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
};

const IntegrationSettingPage = ({
  children,
  open,
  onClose,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) => {
  const t = useI18n();
  const island = useSubPageIsland();

  if (!island) {
    return null;
  }

  return (
    <SubPageProvider
      backText={t['com.notesgraph.integration.integrations']()}
      island={island}
      open={open}
      onClose={onClose}
    >
      {children}
    </SubPageProvider>
  );
};
