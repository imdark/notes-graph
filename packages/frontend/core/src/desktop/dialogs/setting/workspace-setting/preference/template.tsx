import { DeleteIcon } from '@blocksuite/icons/rc';
import {
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Switch,
} from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocDisplayMetaService } from '@notesgraph/core/modules/doc-display-meta';
import { TemplateDocService } from '@notesgraph/core/modules/template-doc';
import { TemplateListMenu } from '@notesgraph/core/modules/template-doc/view/template-list-menu';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import * as styles from './template.css';

export const TemplateDocSetting = () => {
  const t = useI18n();
  const setting = useService(TemplateDocService).setting;

  const enablePageTemplate = useLiveData(setting.enablePageTemplate$);
  const pageTemplateDocId = useLiveData(setting.pageTemplateDocId$);
  const journalTemplateDocId = useLiveData(setting.journalTemplateDocId$);
  const enableJournalProjectSections = useLiveData(
    setting.enableJournalProjectSections$
  );

  const togglePageTemplate = useCallback(
    (enable: boolean) => {
      setting.togglePageTemplate(enable);
    },
    [setting]
  );

  const toggleJournalProjectSections = useCallback(
    (enable: boolean) => {
      setting.toggleJournalProjectSections(enable);
    },
    [setting]
  );

  const updatePageTemplate = useCallback(
    (id?: string) => {
      setting.updatePageTemplateDocId(id);
    },
    [setting]
  );

  const updateJournalTemplate = useCallback(
    (id?: string) => {
      setting.updateJournalTemplateDocId(id);
    },
    [setting]
  );

  return (
    <SettingWrapper
      title={t['com.notesgraph.settings.workspace.template.title']()}
    >
      <SettingRow
        name={t['com.notesgraph.settings.workspace.template.journal']()}
        desc={t['com.notesgraph.settings.workspace.template.journal-desc']()}
      >
        <TemplateSelector
          testId="journal-template-selector"
          current={journalTemplateDocId}
          onChange={updateJournalTemplate}
        />
      </SettingRow>
      {!journalTemplateDocId ? (
        <SettingRow
          name={t[
            'com.notesgraph.settings.workspace.template.journal-project-sections'
          ]()}
          desc={t[
            'com.notesgraph.settings.workspace.template.journal-project-sections-desc'
          ]()}
        >
          <Switch
            data-testid="journal-project-sections-switch"
            checked={enableJournalProjectSections}
            onChange={toggleJournalProjectSections}
          />
        </SettingRow>
      ) : null}
      <SettingRow
        name={t['com.notesgraph.settings.workspace.template.page']()}
        desc={t['com.notesgraph.settings.workspace.template.page-desc']()}
      >
        <Switch
          data-testid="page-template-switch"
          checked={enablePageTemplate}
          onChange={togglePageTemplate}
        />
      </SettingRow>
      {enablePageTemplate ? (
        <SettingRow
          name={t['com.notesgraph.settings.workspace.template.page-select']()}
          desc={null}
        >
          <TemplateSelector
            testId="page-template-selector"
            current={pageTemplateDocId}
            onChange={updatePageTemplate}
          />
        </SettingRow>
      ) : null}
    </SettingWrapper>
  );
};

interface TemplateSelectorProps {
  current?: string;
  testId?: string;
  onChange?: (id?: string) => void;
}
const TemplateSelector = ({
  current,
  testId,
  onChange,
}: TemplateSelectorProps) => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const docDisplayService = useService(DocDisplayMetaService);
  const doc = useLiveData(current ? docsService.list.doc$(current) : null);
  const title = useLiveData(doc ? docDisplayService.title$(doc.id) : null);
  // const isInTrash = useLiveData(doc?.trash$);

  return (
    <TemplateListMenu
      onSelect={onChange}
      contentOptions={{ align: 'end' }}
      suffixItems={
        <>
          <MenuSeparator />
          <MenuItem
            prefixIcon={<DeleteIcon className={styles.menuItemIcon} />}
            onClick={() => onChange?.()}
            type="danger"
            data-testid="template-doc-item-remove"
          >
            {t['com.notesgraph.settings.workspace.template.remove']()}
          </MenuItem>
        </>
      }
    >
      <MenuTrigger className={styles.menuTrigger} data-testid={testId}>
        {/* TODO: in trash design */}
        {title ?? t['com.notesgraph.settings.workspace.template.keep-empty']()}
      </MenuTrigger>
    </TemplateListMenu>
  );
};
