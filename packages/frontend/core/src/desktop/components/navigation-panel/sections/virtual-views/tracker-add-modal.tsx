import { Button, Input, Modal, notify } from '@notesgraph/component';
import { VirtualViewsService } from '@notesgraph/core/modules/virtual-views';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './tracker-add-modal.css';

export const TrackerAddModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useI18n();
  const virtualViewsService = useService(VirtualViewsService);

  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [pattern, setPattern] = useState('');
  const [alertOp, setAlertOp] = useState<'below' | 'above'>('below');
  const [alertValue, setAlertValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setUrl('');
    setLabel('');
    setPattern('');
    setAlertOp('below');
    setAlertValue('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const parsedAlert = alertValue.trim()
        ? Number.parseFloat(alertValue)
        : undefined;
      await virtualViewsService.addTracker({
        url: url.trim(),
        label: label.trim() || undefined,
        pattern: pattern.trim() || undefined,
        alertOp: parsedAlert !== undefined ? alertOp : undefined,
        alertValue: Number.isFinite(parsedAlert) ? parsedAlert : undefined,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      notify.error({
        title: t['com.notesgraph.virtualViews.add-error'](),
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    alertOp,
    alertValue,
    label,
    onOpenChange,
    pattern,
    reset,
    t,
    url,
    virtualViewsService,
  ]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={420}
      title={t['com.notesgraph.virtualViews.tracker.title']()}
    >
      <div className={styles.body}>
        <label className={styles.label}>
          {t['com.notesgraph.virtualViews.tracker.url']()}
        </label>
        <Input value={url} onChange={setUrl} placeholder="https://…" autoFocus />

        <label className={styles.label}>
          {t['com.notesgraph.virtualViews.tracker.name']()}
        </label>
        <Input value={label} onChange={setLabel} />

        <label className={styles.label}>
          {t['com.notesgraph.virtualViews.tracker.pattern']()}
        </label>
        <Input
          value={pattern}
          onChange={setPattern}
          placeholder={t['com.notesgraph.virtualViews.tracker.pattern-hint']()}
        />

        <label className={styles.label}>
          {t['com.notesgraph.virtualViews.tracker.alert']()}
        </label>
        <div className={styles.alertRow}>
          <div className={styles.opToggle}>
            <button
              type="button"
              data-active={alertOp === 'below'}
              className={styles.opButton}
              onClick={() => setAlertOp('below')}
            >
              {t['com.notesgraph.virtualViews.tracker.below']()}
            </button>
            <button
              type="button"
              data-active={alertOp === 'above'}
              className={styles.opButton}
              onClick={() => setAlertOp('above')}
            >
              {t['com.notesgraph.virtualViews.tracker.above']()}
            </button>
          </div>
          <Input
            value={alertValue}
            onChange={setAlertValue}
            type="number"
            placeholder={t['com.notesgraph.virtualViews.tracker.threshold']()}
          />
        </div>

        <div className={styles.actions}>
          <Button onClick={() => onOpenChange(false)}>
            {t['com.notesgraph.confirmModal.button.cancel']()}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!url.trim()}
            loading={submitting}
          >
            {t['com.notesgraph.virtualViews.tracker.add']()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
