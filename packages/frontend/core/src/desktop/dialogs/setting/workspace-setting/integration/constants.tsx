import { AiIcon, TodayIcon } from '@blocksuite/icons/rc';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import { IntegrationTypeIcon } from '@notesgraph/core/modules/integration';
import type { I18nString } from '@notesgraph/i18n';
import type { ReactNode } from 'react';

import { WorkspaceByokSetting } from '../byok';
import { CalendarSettingPanel } from './calendar/setting-panel';
import { GoogleWorkspaceSettingPanel } from './google-workspace/setting-panel';
import MCPIcon from './mcp-server/MCP.inline.svg';
import { McpServerSettingPanel } from './mcp-server/setting-panel';
import { ReadwiseSettingPanel } from './readwise/setting-panel';

type IntegrationCard = {
  id: string;
  name: I18nString;
  desc: I18nString;
  icon: ReactNode;
  cloud?: boolean;
  byok?: boolean;
  adminOnly?: boolean;
} & ({ setting: ReactNode } | { link: string });

const INTEGRATION_LIST = [
  {
    id: 'readwise' as const,
    name: 'com.notesgraph.integration.readwise.name',
    desc: 'com.notesgraph.integration.readwise.desc',
    icon: <IntegrationTypeIcon type="readwise" />,
    setting: <ReadwiseSettingPanel />,
  },
  {
    id: 'calendar' as const,
    name: 'com.notesgraph.integration.calendar.name',
    desc: 'com.notesgraph.integration.calendar.desc',
    icon: <TodayIcon />,
    setting: <CalendarSettingPanel />,
    cloud: true,
  },
  {
    id: 'google-workspace' as const,
    name: 'com.notesgraph.integration.google-workspace.name',
    desc: 'com.notesgraph.integration.google-workspace.desc',
    icon: <NotesGraphLogoIcon />,
    setting: <GoogleWorkspaceSettingPanel />,
    cloud: true,
    adminOnly: true,
  },
  {
    id: 'mcp-server' as const,
    name: 'com.notesgraph.integration.mcp-server.name',
    desc: 'com.notesgraph.integration.mcp-server.desc',
    icon: <img src={MCPIcon} />,
    setting: <McpServerSettingPanel />,
    cloud: true,
  },
  {
    id: 'web-clipper' as const,
    name: 'com.notesgraph.integration.web-clipper.name',
    desc: 'com.notesgraph.integration.web-clipper.desc',
    icon: <NotesGraphLogoIcon />,
    link: 'https://chromewebstore.google.com/detail/notesgraph-web-clipper/mpbbkmbdpleomiogkbkkpfoljjpahmoi',
  },
  {
    id: 'byok' as const,
    name: 'com.notesgraph.settings.workspace.byok.title',
    desc: 'com.notesgraph.settings.workspace.byok.subtitle',
    icon: <AiIcon />,
    setting: <WorkspaceByokSetting />,
    byok: true,
  },
] satisfies (IntegrationCard | false)[];

type IntegrationId = Exclude<
  Extract<(typeof INTEGRATION_LIST)[number], {}>,
  false
>['id'];

export type IntegrationItem = Exclude<IntegrationCard, 'id'> & {
  id: IntegrationId;
};

export function getAllowedIntegrationList(
  isCloudWorkspace: boolean,
  showByok: boolean,
  isWorkspaceAdmin: boolean
) {
  return INTEGRATION_LIST.filter(item => {
    if (!item) return false;
    if ('byok' in item && item.byok && !showByok) return false;
    if ('adminOnly' in item && item.adminOnly && !isWorkspaceAdmin) {
      return false;
    }
    const requiredCloud = 'cloud' in item && item.cloud;
    if (requiredCloud && !isCloudWorkspace) return false;
    return true;
  }) as IntegrationItem[];
}
