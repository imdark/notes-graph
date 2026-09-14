import { Button, Input, Modal, notify } from '@notesgraph/component';
import { VirtualViewsService } from '@notesgraph/core/modules/virtual-views';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './tracker-add-modal.css';

type Mode = 'imap' | 'gmail' | 'gdrive';

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) => (
  <>
    <label className={styles.label}>{label}</label>
    <Input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
    />
  </>
);

export const EmailAddModal = ({
  mode,
  open,
  onOpenChange,
}: {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useI18n();
  const virtualViewsService = useService(VirtualViewsService);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = useCallback(
    (key: string) => (value: string) =>
      setFields(prev => ({ ...prev, [key]: value })),
    []
  );

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      if (mode === 'imap') {
        const port = fields.port ? Number.parseInt(fields.port, 10) : undefined;
        await virtualViewsService.addEmailImap({
          label: fields.label,
          host: fields.host ?? '',
          port,
          secure: port ? port !== 143 : true,
          user: fields.user ?? '',
          password: fields.password ?? '',
          mailbox: fields.mailbox,
        });
      } else {
        const oauth = {
          label: fields.label,
          clientId: fields.clientId ?? '',
          clientSecret: fields.clientSecret ?? '',
          refreshToken: fields.refreshToken ?? '',
          query: fields.query,
        };
        if (mode === 'gdrive') {
          await virtualViewsService.addGoogleDrive(oauth);
        } else {
          await virtualViewsService.addGmail(oauth);
        }
      }
      setFields({});
      onOpenChange(false);
    } catch (error) {
      notify.error({
        title: t['com.notesgraph.virtualViews.add-error'](),
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }, [fields, mode, onOpenChange, t, virtualViewsService]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={420}
      title={
        mode === 'imap'
          ? t['com.notesgraph.virtualViews.email.imap-title']()
          : mode === 'gdrive'
            ? t['com.notesgraph.virtualViews.email.gdrive-title']()
            : t['com.notesgraph.virtualViews.email.gmail-title']()
      }
    >
      <div className={styles.body}>
        {mode === 'imap' ? (
          <>
            <Field
              label={t['com.notesgraph.virtualViews.email.host']()}
              value={fields.host ?? ''}
              onChange={set('host')}
              placeholder="imap.gmail.com"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.port']()}
              value={fields.port ?? ''}
              onChange={set('port')}
              placeholder="993"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.user']()}
              value={fields.user ?? ''}
              onChange={set('user')}
              placeholder="you@example.com"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.password']()}
              value={fields.password ?? ''}
              onChange={set('password')}
              type="password"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.mailbox']()}
              value={fields.mailbox ?? ''}
              onChange={set('mailbox')}
              placeholder="INBOX"
            />
          </>
        ) : (
          <>
            <Field
              label={t['com.notesgraph.virtualViews.email.client-id']()}
              value={fields.clientId ?? ''}
              onChange={set('clientId')}
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.client-secret']()}
              value={fields.clientSecret ?? ''}
              onChange={set('clientSecret')}
              type="password"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.refresh-token']()}
              value={fields.refreshToken ?? ''}
              onChange={set('refreshToken')}
              type="password"
            />
            <Field
              label={t['com.notesgraph.virtualViews.email.query']()}
              value={fields.query ?? ''}
              onChange={set('query')}
              placeholder={mode === 'gdrive' ? 'trashed = false' : 'in:inbox'}
            />
          </>
        )}
        <Field
          label={t['com.notesgraph.virtualViews.tracker.name']()}
          value={fields.label ?? ''}
          onChange={set('label')}
        />

        <div className={styles.actions}>
          <Button onClick={() => onOpenChange(false)}>
            {t['com.notesgraph.confirmModal.button.cancel']()}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            loading={submitting}
          >
            {t['com.notesgraph.virtualViews.email.connect']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
