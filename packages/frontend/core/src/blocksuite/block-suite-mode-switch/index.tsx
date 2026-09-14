import type { DocMode } from '@blocksuite/notesgraph/model';
import { RadioGroup, type RadioItem } from '@notesgraph/component';
import { registerNotesGraphCommand } from '@notesgraph/core/commands';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorService } from '@notesgraph/core/modules/editor';
import {
  ViewService,
  WorkbenchService,
} from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import {
  useLiveData,
  useService,
  useServiceOptional,
  useServices,
} from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { createElement, useCallback, useEffect, useMemo } from 'react';

import { switchItem } from './style.css';

export interface EditorModeSwitchProps {
  pageId: string;
  isPublic?: boolean;
  publicMode?: DocMode;
}

export const EditorModeSwitch = () => {
  const t = useI18n();
  const { editorService, docModeRegistryService } = useServices({
    EditorService,
    DocModeRegistryService,
  });
  const editor = editorService.editor;
  const trash = useLiveData(editor.doc.trash$);
  const currentMode = useLiveData(editor.mode$);
  const modes = useLiveData(docModeRegistryService.modes$);
  const view = useServiceOptional(ViewService)?.view;
  const workbench = useServiceOptional(WorkbenchService)?.workbench;
  const activeView = useLiveData(workbench?.activeView$);
  const isActiveView = activeView?.id && activeView?.id === view?.id;

  const onModeChange = useCallback(
    (mode: DocMode) => {
      if (mode === currentMode || trash) return;
      editor.setMode(mode);
      editor.setSelector(undefined);
      track.$.header.actions.switchPageMode({ mode });
    },
    [currentMode, editor, trash]
  );

  const shouldHide = useCallback(
    (mode: DocMode) => !!trash && currentMode !== mode,
    [currentMode, trash]
  );

  // Alt+S cycles to the next registered mode (a toggle when there are two).
  useEffect(() => {
    if (trash || currentMode === undefined || !isActiveView || modes.length < 2)
      return;
    const ids = modes.map(mode => mode.id);
    const nextMode = ids[(ids.indexOf(currentMode) + 1) % ids.length];
    if (!nextMode) return;
    const NextIcon = modes.find(mode => mode.id === nextMode)?.icon;
    return registerNotesGraphCommand({
      id: 'notesgraph:doc-mode-switch',
      category: 'editor:page',
      label: t.t(`com.notesgraph.cmdk.switch-to-${nextMode}`),
      icon: NextIcon ? createElement(NextIcon) : undefined,
      keyBinding: {
        binding: 'Alt+KeyS',
        capture: true,
      },
      run: () => onModeChange(nextMode),
    });
  }, [currentMode, isActiveView, modes, onModeChange, t, trash]);

  // No toggle when there is only one mode (e.g. edgeless plugin disabled).
  if (modes.length < 2) return null;

  return (
    <PureEditorModeSwitch
      mode={currentMode}
      setMode={onModeChange}
      hidden={shouldHide}
    />
  );
};

export interface PureEditorModeSwitchProps {
  mode?: DocMode;
  setMode?: (mode: DocMode) => void;
  /** Optionally hide a mode from the toggle (e.g. the non-current mode in trash). */
  hidden?: (mode: DocMode) => boolean;
}

export const PureEditorModeSwitch = ({
  mode,
  setMode,
  hidden,
}: PureEditorModeSwitchProps) => {
  const modes = useLiveData(useService(DocModeRegistryService).modes$);
  const items = useMemo<RadioItem[]>(
    () =>
      modes
        .filter(descriptor => !hidden?.(descriptor.id))
        .map(descriptor => ({
          value: descriptor.id,
          label: descriptor.toggleItem ?? createElement(descriptor.icon),
          testId: `switch-${descriptor.id}-mode-button`,
          className: switchItem,
        })),
    [hidden, modes]
  );
  return (
    <RadioGroup
      iconMode
      itemHeight={24}
      borderRadius={8}
      padding={4}
      gap={8}
      value={mode}
      items={items}
      onChange={value => setMode?.(value as DocMode)}
    />
  );
};
