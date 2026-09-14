import { ExpiredPage } from '@notesgraph/component/member-components';
import { useCallback } from 'react';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';

/**
 * /expired page
 *
 * only on web
 */
export const Component = () => {
  const { jumpToIndex } = useNavigateHelper();
  const onOpenNotesGraph = useCallback(() => {
    jumpToIndex(RouteLogic.REPLACE);
  }, [jumpToIndex]);

  return <ExpiredPage onOpenNotesGraph={onOpenNotesGraph} />;
};
