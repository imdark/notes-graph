import type { SharedRun } from '@notesgraph/core/modules/agents';
import { FetchService } from '@notesgraph/core/modules/cloud';
import { UserFriendlyError } from '@notesgraph/error';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AgentLogView } from '../workspace/detail-page/tabs/agent-log-view';
import * as agentStyles from '../workspace/detail-page/tabs/agents.css';
import * as styles from './index.css';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; run: SharedRun };

const STATUS_KEYS = {
  queued: 'com.notesgraph.shared-run.status.queued',
  running: 'com.notesgraph.shared-run.status.running',
  done: 'com.notesgraph.shared-run.status.done',
  error: 'com.notesgraph.shared-run.status.error',
  cancelled: 'com.notesgraph.shared-run.status.cancelled',
} as const;

/**
 * /share/run/:token — a read-only snapshot of an agent run, for anyone with
 * the link. No sign-in: the token is the credential.
 */
export const Component = () => {
  const t = useI18n();
  const { token = '' } = useParams();
  const fetchService = useService(FetchService);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchService
      .fetch(`/api/registry/shared-runs/${encodeURIComponent(token)}`, {
        signal: controller.signal,
      })
      .then(res => res.json() as Promise<{ run: SharedRun }>)
      .then(({ run }) => setState({ kind: 'ready', run }))
      .catch(err => {
        if (controller.signal.aborted) return;
        setState(
          err instanceof UserFriendlyError && err.status === 404
            ? { kind: 'missing' }
            : {
                kind: 'failed',
                message: err instanceof Error ? err.message : String(err),
              }
        );
      });
    return () => controller.abort();
  }, [fetchService, token]);

  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <div className={styles.content}>
          <p
            className={
              state.kind === 'failed' ? agentStyles.error : agentStyles.empty
            }
            data-testid="shared-run-state"
          >
            {state.kind === 'loading'
              ? t['com.notesgraph.shared-run.loading']()
              : state.kind === 'missing'
                ? t['com.notesgraph.shared-run.not-found']()
                : `${t['com.notesgraph.shared-run.load-failed']()} ${state.message}`}
          </p>
        </div>
      </div>
    );
  }

  const { run } = state;
  const statusKey = STATUS_KEYS[run.status as keyof typeof STATUS_KEYS];
  const status = statusKey ? t[statusKey]() : run.status;

  return (
    <div className={styles.page}>
      <main className={styles.content} data-testid="shared-run">
        <header className={styles.header}>
          <h1 className={styles.title}>
            {run.title || t['com.notesgraph.shared-run.untitled']()}
          </h1>
          <span className={agentStyles.hint}>
            {status} · {t['com.notesgraph.shared-run.snapshot']()} ·{' '}
            {new Date(run.sharedAt * 1000).toLocaleString()}
          </span>
        </header>

        {run.error ? <p className={agentStyles.error}>{run.error}</p> : null}

        {run.result ? (
          <section className={agentStyles.section}>
            <span className={agentStyles.sectionLabel}>
              {t['com.notesgraph.shared-run.result']()}
            </span>
            <pre className={agentStyles.runDetailInput}>{run.result}</pre>
          </section>
        ) : null}

        {run.questions.length ? (
          <section className={agentStyles.section}>
            <span className={agentStyles.sectionLabel}>
              {t['com.notesgraph.shared-run.questions']()}
            </span>
            <ul className={styles.questions}>
              {run.questions.map((question, index) => (
                <li key={index} className={styles.question}>
                  <span>{question.text}</span>
                  <span className={styles.answer}>
                    {question.kind === 'permission' && question.allowed !== null
                      ? question.allowed
                        ? t['com.notesgraph.shared-run.allowed']()
                        : t['com.notesgraph.shared-run.denied']()
                      : (question.answer ??
                        t['com.notesgraph.shared-run.unanswered']())}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={agentStyles.section}>
          <span className={agentStyles.sectionLabel}>
            {t['com.notesgraph.shared-run.transcript']()}
          </span>
          <div className={styles.transcript}>
            <AgentLogView
              log={run.log}
              resetKey={token}
              placeholder={t['com.notesgraph.shared-run.empty-log']()}
            />
          </div>
        </section>
      </main>
    </div>
  );
};
