import { ExplorerNavigation } from '@notesgraph/core/components/explorer/header/navigation';
import { Header } from '@notesgraph/core/components/pure/header';

export const AllTagHeader = () => {
  return <Header left={<ExplorerNavigation active={'tags'} />} />;
};
