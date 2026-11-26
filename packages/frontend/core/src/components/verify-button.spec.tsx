/**
 * @vitest-environment happy-dom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const tokens = vi.hoisted(() => ({
  VerifyService: class VerifyService {},
  FeatureFlagService: class FeatureFlagService {},
}));
const state = vi.hoisted(() => ({
  enabled: true,
  started: null as null | { runId: string | null },
  verify: null as any,
}));

vi.mock('@notesgraph/infra', () => ({
  useService: (token: unknown) =>
    token === tokens.FeatureFlagService
      ? { flags: { enable_verify_buttons: { $: { value: state.enabled } } } }
      : { verify: state.verify, watch: () => ({ value: state.started }) },
  useLiveData: (live: { value: unknown }) => live.value,
}));
vi.mock('@notesgraph/component', () => ({
  Button: ({ children, onClick, disabled, loading, tooltip, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@notesgraph/core/modules/agents', () => ({
  VerifyService: tokens.VerifyService,
  VERIFICATIONS_DOC_TITLE: 'Verifications',
  verifyKey: (t: { kind: string }) => t.kind,
}));
vi.mock('@notesgraph/core/modules/feature-flag', () => ({
  FeatureFlagService: tokens.FeatureFlagService,
}));

const { VerifyButton } = await import('./verify-button');

const target = {
  kind: 'branch' as const,
  repo: 'imdark/notes-graph',
  branch: 'cloud-147-generate-title',
  base: 'stage',
};

afterEach(() => {
  cleanup();
  state.enabled = true;
  state.started = null;
});

describe('Verify', () => {
  test('is hidden while its flag is off', () => {
    state.enabled = false;
    render(<VerifyButton target={target} onOpenRun={() => {}} />);
    expect(screen.queryByTestId('verify-branch')).toBeNull();
  });

  test('starts a verification of its target and opens the run it gets', async () => {
    state.verify = vi.fn(async () => ({ runId: 'run-v' }));
    const onOpenRun = vi.fn();
    render(<VerifyButton target={target} onOpenRun={onOpenRun} />);

    fireEvent.click(screen.getByTestId('verify-branch'));

    expect(state.verify).toHaveBeenCalledWith(target);
    await waitFor(() => expect(onOpenRun).toHaveBeenCalledWith('run-v'));
  });

  test('once started, offers to verify again and to show the agent', () => {
    state.started = { runId: 'run-v' };
    const onOpenRun = vi.fn();
    render(<VerifyButton target={target} onOpenRun={onOpenRun} />);

    expect(screen.getByTestId('verify-branch').textContent).toBe(
      'Verify again'
    );
    fireEvent.click(screen.getByTestId('verify-branch-show'));
    expect(onOpenRun).toHaveBeenCalledWith('run-v');
  });
});
