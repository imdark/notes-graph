import type { DeployInfo } from '../../../core/config';

/** How many of the deployed pull requests to list when none are asked about. */
export const DEPLOY_INFO_PR_LIMIT = 30;

/**
 * What the deploy_info tool answers: the running build's deploy record and,
 * for `pullRequests` asked about, whether each is in it. `pullRequests` in
 * the record is bounded (see scripts/prod/deploy-info.mjs), so a number
 * older than its oldest entry can't be told, rather than said not to be live.
 */
export function deployInfoAnswer(
  info: DeployInfo | null,
  pullRequests?: number[]
): Record<string, unknown> {
  if (!info) {
    return {
      deployed: false,
      message:
        'This server has no deploy record: it was not deployed with one (a dev or self-hosted build).',
    };
  }
  const { pullRequests: included, featureFlags, ...build } = info;
  const answer: Record<string, unknown> = {
    deployed: true,
    ...build,
    pullRequestCount: included.length,
    featureFlags: featureFlags ?? null,
  };
  if (!pullRequests?.length) {
    answer.pullRequests = included.slice(0, DEPLOY_INFO_PR_LIMIT);
    return answer;
  }
  const live = new Set(included);
  const oldest = included.length ? Math.min(...included) : Infinity;
  answer.checked = pullRequests.map(number => ({
    number,
    live: live.has(number) ? true : number < oldest ? null : false,
  }));
  return answer;
}
