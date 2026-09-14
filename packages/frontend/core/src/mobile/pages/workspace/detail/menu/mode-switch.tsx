import type { DocMode } from '@blocksuite/notesgraph/model';
import {
  RadioGroup,
  type RadioItem,
  useMobileMenuController,
} from '@notesgraph/component';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { useCallback, useMemo } from 'react';

import * as styles from './mode-switch.css';

export const EditorModeSwitch = () => {
  const t = useI18n();
  const { close } = useMobileMenuController();
  const { editorService, docModeRegistryService } = useServices({
    EditorService,
    DocModeRegistryService,
  });
  const editor = editorService.editor;
  const trash = useLiveData(editor.doc.trash$);
  const isSharedMode = editor.isSharedMode;
  const currentMode = useLiveData(editor.mode$);
  const modes = useLiveData(docModeRegistryService.modes$);

  const onToggle = useCallback(
    (mode: DocMode) => {
      editor.setMode(mode);
      editor.setSelector(undefined);
      track.$.header.actions.switchPageMode({ mode });
      close();
    },
    [close, editor]
  );

  const items = useMemo<RadioItem[]>(
    () =>
      modes.map(mode => ({
        value: mode.id,
        label: t.t(mode.labelKey),
        testId: `switch-${mode.id}-mode-button`,
      })),
    [modes, t]
  );

  // No toggle in trash / shared mode, or when only one mode is registered.
  if (trash || isSharedMode || modes.length < 2) {
    return null;
  }

  return (
    <div className={styles.radioWrapper}>
      <RadioGroup
        itemHeight={28}
        width="100%"
        borderRadius={8}
        padding={2}
        gap={4}
        value={currentMode}
        items={items}
        onChange={value => onToggle(value as DocMode)}
      />
    </div>
  );
};
