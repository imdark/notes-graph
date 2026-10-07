import {
  AiIcon,
  AllDocsIcon,
  AttachmentIcon,
  ComputerPanelIcon,
  DeleteIcon,
  EdgelessIcon,
  ExportToPdfIcon,
  MindmapIcon,
  PageIcon,
  PublishIcon,
  TagIcon,
  TodayIcon,
  ViewLayersIcon,
} from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

export const iconNameToIcon = {
  allDocs: <AllDocsIcon />,
  collection: <ViewLayersIcon />,
  doc: <PageIcon />,
  page: <PageIcon />,
  edgeless: <EdgelessIcon />,
  graph: <MindmapIcon />,
  journal: <TodayIcon />,
  tag: <TagIcon />,
  trash: <DeleteIcon />,
  attachment: <AttachmentIcon />,
  pdf: <ExportToPdfIcon />,
  ai: <AiIcon />,
  deploy: <PublishIcon />,
  monitoring: <ComputerPanelIcon />,
} satisfies Record<string, ReactNode>;

export type ViewIconName = keyof typeof iconNameToIcon;
