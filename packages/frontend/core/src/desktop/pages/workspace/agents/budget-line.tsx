import { Button, Input, notify } from '@notesgraph/component';
import {
  type AgentBudget,
  RemoteAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './agents-page.css';

const usd = (value: number) => `$${value.toFixed(2)}`;

/** A budget typed in: a positive amount, blank for none, or null if neither. */
const parseBudget = (text: string): number | null | undefined => {
  const trimmed = text.trim().replace(/^\$/, '');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * This month's agent spend in the workspace, against its monthly budget, with
 * a way to set or clear the budget. Device and cloud runs report what they
 * cost; once the month's spend reaches the budget the server refuses new runs.
 *
 * `refreshKey` changes when runs end, which is when the spend moves.
 */
export const BudgetLine = ({ refreshKey }: { refreshKey: number }) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceId = useService(WorkspaceService).workspace?.id;
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId || !remoteRunner.hasServer) return;
    let cancelled = false;
    remoteRunner
      .budget(workspaceId)
      .then(next => {
        if (cancelled) return;
        setBudget(next);
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, remoteRunner, workspaceId]);

  const startEditing = useCallback(() => {
    setDraft(budget?.monthlyUsd ? String(budget.monthlyUsd) : '');
    setEditing(true);
  }, [budget]);

  const parsed = parseBudget(draft);

  const save = useCallback(() => {
    if (!workspaceId || parsed === undefined) return;
    setSaving(true);
    remoteRunner
      .setBudget(workspaceId, parsed)
      .then(next => {
        setBudget(next);
        setEditing(false);
      })
      .catch((err: Error) => {
        notify.error({
          title: "Couldn't save the budget",
          message: err.message,
        });
      })
      .finally(() => setSaving(false));
  }, [parsed, remoteRunner, workspaceId]);

  // A local workspace has no server, so nothing is spent and nothing to cap.
  if (!workspaceId || !remoteRunner.hasServer) return null;

  if (loadError && !budget) {
    return (
      <div className={styles.budget} data-testid="agents-page-budget">
        Couldn&apos;t load this month&apos;s spend: {loadError}
      </div>
    );
  }
  if (!budget) {
    return (
      <div className={styles.budget} data-testid="agents-page-budget">
        Loading this month&apos;s spend…
      </div>
    );
  }

  if (editing) {
    return (
      <div className={styles.budget} data-testid="agents-page-budget">
        <span>Monthly budget ($)</span>
        <Input
          className={styles.budgetInput}
          value={draft}
          onChange={setDraft}
          onEnter={save}
          inputMode="decimal"
          placeholder="No budget"
          autoFocus
          status={parsed === undefined ? 'error' : 'default'}
          data-testid="agents-page-budget-input"
        />
        <Button
          variant="primary"
          onClick={save}
          disabled={saving || parsed === undefined}
          data-testid="agents-page-budget-save"
        >
          Save
        </Button>
        <Button variant="plain" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <span>
          {parsed === undefined
            ? 'Enter an amount above zero, or leave it blank for no budget.'
            : 'Leave blank for no budget.'}
        </span>
      </div>
    );
  }

  const over =
    budget.monthlyUsd !== null && budget.spentUsd >= budget.monthlyUsd;
  return (
    <div className={styles.budget} data-testid="agents-page-budget">
      <span className={over ? styles.budgetOver : undefined}>
        This month: {usd(budget.spentUsd)}
        {budget.monthlyUsd !== null
          ? ` of ${usd(budget.monthlyUsd)} budget`
          : ''}
        {over
          ? '. New runs are refused until next month or a higher budget.'
          : ''}
      </span>
      <Button
        variant="plain"
        onClick={startEditing}
        data-testid="agents-page-budget-edit"
      >
        {budget.monthlyUsd !== null ? 'Change budget' : 'Set a monthly budget'}
      </Button>
    </div>
  );
};
