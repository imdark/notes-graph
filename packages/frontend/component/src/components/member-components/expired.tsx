import { useI18n } from '@notesgraph/i18n';

import { Button } from '../../ui/button';
import { AuthPageContainer } from '../auth-components';

export const ExpiredPage = ({
  onOpenNotesGraph,
}: {
  onOpenNotesGraph: () => void;
}) => {
  const t = useI18n();
  return (
    <AuthPageContainer
      title={t['com.notesgraph.expired.page.title']()}
      subtitle={t['com.notesgraph.expired.page.new-subtitle']()}
    >
      <Button variant="primary" size="large" onClick={onOpenNotesGraph}>
        {t['com.notesgraph.auth.open.notesgraph']()}
      </Button>
    </AuthPageContainer>
  );
};
