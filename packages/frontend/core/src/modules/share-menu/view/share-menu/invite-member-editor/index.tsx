import { SearchIcon } from '@blocksuite/icons/rc';
import { Input } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';
import { cssVar } from '@toeverything/theme';

import * as styles from './styles.css';

export const InviteInput = ({ onFocus }: { onFocus: () => void }) => {
  const t = useI18n();

  return (
    <Input
      preFix={<SearchIcon className={styles.iconStyle} />}
      className={styles.inputStyle}
      onFocus={onFocus}
      inputStyle={{
        paddingLeft: '0',
        fontSize: cssVar('fontSm'),
      }}
      placeholder={t['com.notesgraph.share-menu.invite-editor.placeholder']()}
    />
  );
};
