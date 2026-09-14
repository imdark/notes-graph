import { Button } from '@notesgraph/component';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { useI18n } from '@notesgraph/i18n';

export const ImportTemplateButton = ({
  name,
  snapshotUrl,
}: {
  name: string;
  snapshotUrl: string;
}) => {
  const t = useI18n();
  const { jumpToImportTemplate } = useNavigateHelper();
  return (
    <Button
      variant="primary"
      onClick={() => jumpToImportTemplate(name, snapshotUrl)}
    >
      {t['com.notesgraph.share-page.header.import-template']()}
    </Button>
  );
};
