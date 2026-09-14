import { EdgelessIcon, PageIcon } from '@blocksuite/icons/rc';
import type { DocMode } from '@blocksuite/notesgraph/model';
import {
  MenuItem,
  notify,
  PropertyValue,
  type RadioItem,
} from '@notesgraph/component';
import type { FilterParams } from '@notesgraph/core/modules/collection-rules';
import { DocService } from '@notesgraph/core/modules/doc';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import { PlainTextDocGroupHeader } from '../explorer/docs-view/group-header';
import { StackProperty } from '../explorer/docs-view/stack-property';
import type { DocListPropertyProps, GroupHeaderProps } from '../explorer/types';
import { FilterValueMenu } from '../filter/filter-value-menu';
import type { PropertyValueProps } from '../properties/types';
import { PropertyRadioGroup } from '../properties/widgets/radio-group';
import * as styles from './doc-primary-mode.css';

export const DocPrimaryModeValue = ({
  onChange,
  readonly,
}: PropertyValueProps) => {
  const t = useI18n();
  const { docService, docModeRegistryService } = useServices({
    DocService,
    DocModeRegistryService,
  });
  const doc = docService.doc;

  const primaryMode = useLiveData(doc.primaryMode$);
  const modes = useLiveData(docModeRegistryService.modes$);

  const DocModeItems = useMemo<RadioItem[]>(
    () =>
      modes.map(mode => ({
        value: mode.id as DocMode,
        label: t.t(mode.labelKey),
      })),
    [modes, t]
  );

  const handleChange = useCallback(
    (mode: DocMode) => {
      doc.setPrimaryMode(mode);
      notify.success({
        title: t.t(`com.notesgraph.toastMessage.defaultMode.${mode}.title`),
        message: t.t(`com.notesgraph.toastMessage.defaultMode.${mode}.message`),
      });
      onChange?.(mode, true);
    },
    [doc, t, onChange]
  );
  return (
    <PropertyValue
      className={styles.container}
      hoverable={false}
      readonly={readonly}
    >
      <PropertyRadioGroup
        value={primaryMode}
        onChange={handleChange}
        items={DocModeItems}
        disabled={readonly}
      />
    </PropertyValue>
  );
};

export const DocPrimaryModeFilterValue = ({
  filter,
  isDraft,
  onDraftCompleted,
  onChange,
}: {
  filter: FilterParams;
  isDraft?: boolean;
  onDraftCompleted?: () => void;
  onChange?: (filter: FilterParams) => void;
}) => {
  const t = useI18n();

  return (
    <FilterValueMenu
      isDraft={isDraft}
      onDraftCompleted={onDraftCompleted}
      items={
        <>
          <MenuItem
            onClick={() => {
              onChange?.({
                ...filter,
                value: 'page',
              });
            }}
            selected={filter.value !== 'edgeless'}
          >
            {t['Page']()}
          </MenuItem>
          <MenuItem
            onClick={() => {
              onChange?.({
                ...filter,
                value: 'edgeless',
              });
            }}
            selected={filter.value === 'edgeless'}
          >
            {t['Edgeless']()}
          </MenuItem>
        </>
      }
    >
      <span>{filter.value === 'edgeless' ? t['Edgeless']() : t['Page']()}</span>
    </FilterValueMenu>
  );
};

export const DocPrimaryModeDocListProperty = ({
  doc,
}: DocListPropertyProps) => {
  const t = useI18n();
  const primaryMode = useLiveData(doc.primaryMode$);

  return (
    <StackProperty
      icon={primaryMode === 'edgeless' ? <EdgelessIcon /> : <PageIcon />}
    >
      {primaryMode === 'edgeless' ? t['Edgeless']() : t['Page']()}
    </StackProperty>
  );
};

export const DocPrimaryModeGroupHeader = ({
  groupId,
  docCount,
}: GroupHeaderProps) => {
  const t = useI18n();
  const text =
    groupId === 'edgeless'
      ? t['com.notesgraph.edgelessMode']()
      : groupId === 'page'
        ? t['com.notesgraph.pageMode']()
        : 'Default';

  return (
    <PlainTextDocGroupHeader groupId={groupId} docCount={docCount}>
      {text}
    </PlainTextDocGroupHeader>
  );
};
