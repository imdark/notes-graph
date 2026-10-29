import { notify } from '@notesgraph/component';
import {
  type DeployInfo,
  DeploymentsService,
  flagStage,
} from '@notesgraph/core/modules/agents';
import {
  FeatureFlagService,
  type Flag,
  NOTESGRAPH_FLAGS,
} from '@notesgraph/core/modules/feature-flag';
import {
  type AdminFlagSetting,
  FeatureFlagAdminService,
} from '@notesgraph/core/modules/feature-flag/admin';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from '../deployments/styles.css';

const FLAG_KEYS = Object.keys(NOTESGRAPH_FLAGS) as (keyof NOTESGRAPH_FLAGS)[];

const settingValue = (setting: AdminFlagSetting) =>
  setting === null ? 'users' : setting ? 'on' : 'off';

/** The commit a flag was added in, linked to GitHub when prod names its repo. */
const CommitLink = ({
  commit,
  deploy,
}: {
  commit: string;
  deploy: DeployInfo | null | undefined;
}) => {
  if (!commit) return <span className={styles.badgeBad}>No commit</span>;
  const short = <code>{commit.slice(0, 7)}</code>;
  if (!deploy?.repo) return short;
  return (
    <a
      className={styles.link}
      href={`https://github.com/${deploy.repo}/commit/${commit}`}
      target="_blank"
      rel="noreferrer"
      title="The commit that added this flag"
    >
      {short}
    </a>
  );
};

/** Whether prod's build has the flag, by the commit stamped on it. */
export const FlagStageBadge = ({
  flagKey,
  commit,
  deploy,
}: {
  flagKey: string;
  commit: string;
  deploy: DeployInfo | null | undefined;
}) => {
  const stage = flagStage(flagKey, commit, deploy);
  if (stage === 'deployed') {
    return <span className={styles.badgeGood}>In prod</span>;
  }
  if (stage === 'not-deployed') {
    return <span className={styles.badgeBad}>Not in prod</span>;
  }
  return null;
};

const FlagRow = ({
  flagKey,
  flag,
  deploy,
  setting,
  canEdit,
  saving,
  onChange,
}: {
  flagKey: string;
  flag: Flag;
  deploy: DeployInfo | null | undefined;
  setting: AdminFlagSetting;
  canEdit: boolean;
  saving: boolean;
  onChange: (setting: AdminFlagSetting) => void;
}) => {
  const t = useI18n();
  const value = useLiveData(flag.$);
  const defaultLabel = flag.defaultState ? 'on' : 'off';
  return (
    <div className={styles.row} data-testid={`feature-flag-${flagKey}`}>
      <div className={styles.rowBody}>
        <span className={styles.rowTitle}>{t[flag.displayName]()}</span>
        <span className={styles.rowMeta}>
          <code>{flagKey}</code>
          <CommitLink commit={flag.commit} deploy={deploy} />
          <FlagStageBadge
            flagKey={flagKey}
            commit={flag.commit}
            deploy={deploy}
          />
          <span>{value ? 'On' : 'Off'} here</span>
        </span>
      </div>
      <select
        className={styles.flagSelect}
        value={settingValue(setting)}
        disabled={!canEdit || saving}
        onChange={event => {
          const next = event.target.value;
          onChange(next === 'users' ? null : next === 'on');
        }}
        aria-label={`Who decides ${flagKey}`}
        data-testid="feature-flag-setting"
      >
        <option value="users">
          {flag.configurable === false
            ? `Default (${defaultLabel})`
            : `Each user (default ${defaultLabel})`}
        </option>
        <option value="on">On for everyone</option>
        <option value="off">Off for everyone</option>
      </select>
    </div>
  );
};

/**
 * Every feature flag in this build: the commit it came in with, whether
 * prod's build has it, and what it is set to. A server admin can turn one on
 * or off for everyone (config `flags.featureOverrides`), which wins over each
 * user's own setting; anyone else sees the list read-only.
 */
export const FeatureFlagsView = () => {
  const flags = useService(FeatureFlagService).flags;
  const admin = useService(FeatureFlagAdminService);
  const deployments = useService(DeploymentsService);
  const overrides = useLiveData(admin.overrides$);
  const error = useLiveData(admin.error$);
  const isAdmin$ = useMemo(() => admin.isAdmin$, [admin]);
  const isAdmin = useLiveData(isAdmin$);
  const deploy = useLiveData(deployments.deployInfo$);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    admin.refresh().catch(() => {});
    deployments.refreshDeployInfo().catch(() => {});
  }, [admin, deployments]);

  const notInProd = FLAG_KEYS.filter(
    key => flagStage(key, flags[key].commit, deploy) === 'not-deployed'
  ).length;

  const change = (key: string, setting: AdminFlagSetting) => {
    setSaving(key);
    admin
      .set(key, setting)
      .catch(err => {
        notify.error({
          title: 'Could not change the flag',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setSaving(null));
  };

  return (
    <div className={styles.content} data-testid="feature-flags-view">
      <div className={styles.sectionHint}>
        {deploy === undefined
          ? 'Checking what prod runs…'
          : deploy?.featureFlags
            ? `Checked against prod's build ${deploy.commit.slice(0, 7)}: ${
                notInProd === 0
                  ? 'it has every flag listed here.'
                  : `${notInProd} of these ${notInProd === 1 ? 'is' : 'are'} not in it yet.`
              }`
            : "Prod's deploy record doesn't list feature flags yet, so they can't be checked against it. It will from the next deploy."}
      </div>
      {isAdmin ? null : (
        <div className={styles.sectionHint}>
          Only this server&apos;s admin can turn flags on or off for everyone.
        </div>
      )}
      {error ? <div className={styles.runError}>{error}</div> : null}
      <div className={styles.rows}>
        {FLAG_KEYS.map(key => {
          const flag = flags[key] as Flag;
          const setting = overrides?.[key];
          return (
            <FlagRow
              key={key}
              flagKey={key}
              flag={flag}
              deploy={deploy}
              setting={typeof setting === 'boolean' ? setting : null}
              canEdit={!!isAdmin && overrides !== null}
              saving={saving === key}
              onChange={next => change(key, next)}
            />
          );
        })}
      </div>
    </div>
  );
};
