import { useI18n } from '@notesgraph/i18n';
import { cssVar } from '@toeverything/theme';

import Input from '../../../ui/input';
import * as styles from './styles.css';

export const EmailInvite = ({
  inviteEmail,
  setInviteEmail,
  handleConfirm,
  importCSV,
  isMutating,
  isValidEmail,
}: {
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  handleConfirm: () => void;
  isMutating: boolean;
  isValidEmail: boolean;
  importCSV: React.ReactNode;
}) => {
  const t = useI18n();
  return (
    <>
      <div className={styles.modalSubTitle}>
        {t['com.notesgraph.payment.member.team.invite.email-invite']()}
      </div>
      <div>
        <Input
          inputStyle={{ fontSize: cssVar('fontXs') }}
          disabled={isMutating}
          placeholder={t[
            'com.notesgraph.payment.member.team.invite.email-placeholder'
          ]()}
          value={inviteEmail}
          onChange={setInviteEmail}
          onEnter={handleConfirm}
          size="large"
        />
        {!isValidEmail ? (
          <div className={styles.errorHint}>
            {t['com.notesgraph.auth.sign.email.error']()}
          </div>
        ) : null}
      </div>
      <div>{importCSV}</div>
    </>
  );
};
