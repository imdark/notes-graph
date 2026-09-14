import { PresentationIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@notesgraph/component';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useService } from '@notesgraph/infra';

export const DetailPageHeaderPresentButton = () => {
  const editorService = useService(EditorService);

  return (
    <IconButton
      style={{ flexShrink: 0 }}
      size="24"
      onClick={() => editorService.editor.togglePresentation()}
    >
      <PresentationIcon />
    </IconButton>
  );
};
