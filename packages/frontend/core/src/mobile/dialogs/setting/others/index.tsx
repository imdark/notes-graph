import { useI18n } from '@notesgraph/i18n';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';
import { DeleteAccount } from './delete-account';
import { hotTag } from './index.css';

export const OthersGroup = () => {
  const t = useI18n();

  return (
    <SettingGroup title={t['com.notesgraph.mobile.setting.others.title']()}>
      <RowLayout
        label={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t['com.notesgraph.mobile.setting.others.discord']()}
            <div className={hotTag}>Hot</div>
          </div>
        }
        href="https://discord.com/invite/whd5mjYqVw"
      />
      <RowLayout
        label={t['com.notesgraph.mobile.setting.others.github']()}
        href="https://github.com/notesgraph/notesgraph"
      />

      <RowLayout
        label={t['com.notesgraph.mobile.setting.others.website']()}
        href="https://notesgraph.com/"
      />

      <RowLayout
        label={t['com.notesgraph.mobile.setting.others.privacy']()}
        href="https://notesgraph.com/privacy"
      />

      <RowLayout
        label={t['com.notesgraph.mobile.setting.others.terms']()}
        href="https://notesgraph.com/terms"
      />
      <DeleteAccount />
    </SettingGroup>
  );
};
