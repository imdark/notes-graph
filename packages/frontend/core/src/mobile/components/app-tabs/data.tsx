import { AllDocsIcon, HomeIcon, SearchIcon } from '@blocksuite/icons/rc';

import { AppTabCreate } from './create';
import { AppTabJournal } from './journal';
import type { Tab } from './type';

export const tabs: Tab[] = [
  {
    key: 'home',
    to: '/home',
    Icon: HomeIcon,
  },
  {
    key: 'all',
    to: '/all',
    Icon: AllDocsIcon,
  },
  {
    key: 'search',
    to: '/search',
    Icon: SearchIcon,
  },
  {
    key: 'journal',
    custom: AppTabJournal,
  },
  {
    key: 'new',
    custom: AppTabCreate,
  },
];
