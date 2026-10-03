/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppLockProvider,
  AppLockService,
  type AppLockState,
  configureAppLockModule,
} from '../modules/app-lock';

const holder = vi.hoisted(() => ({ service: null as unknown }));

vi.mock('@notesgraph/infra', async importOriginal => ({
  ...(await importOriginal<typeof import('@notesgraph/infra')>()),
  useService: () => holder.service,
}));

vi.mock('@notesgraph/i18n', () => ({
  useI18n: () =>
    new Proxy({} as Record<string, () => string>, {
      get: (_t, key: string) => () => key,
    }),
}));

// The real settings chrome pulls in the mobile modal stack; only the switch
// and the hint matter here.
vi.mock('../mobile/dialogs/setting/group', () => ({
  SettingGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../mobile/dialogs/setting/row.layout', () => ({
  RowLayout: ({
    label,
    children,
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));

const { SecurityGroup } = await import('../mobile/dialogs/setting/security');

function provider(initial: AppLockState, unlockSucceeds = true) {
  let state = initial;
  return {
    getState: vi.fn(async () => state),
    setEnabled: vi.fn(async (enabled: boolean) => {
      // turning it on is gated by an unlock prompt
      if (!enabled || unlockSucceeds) state = { ...state, enabled };
      return state;
    }),
  };
}

/** Through the real module wiring: no provider registered means no app lock. */
function service(impl?: AppLockProvider) {
  const framework = new Framework();
  configureAppLockModule(framework);
  if (impl) framework.impl(AppLockProvider, impl);
  return framework.provider().get(AppLockService);
}

afterEach(cleanup);

describe('SecurityGroup', () => {
  it('renders nothing on a platform with no app lock', () => {
    holder.service = service();
    const { container } = render(<SecurityGroup />);
    expect(container.firstChild).toBeNull();
  });

  it('turns the lock on once the unlock prompt succeeds', async () => {
    const p = provider({ available: true, enabled: false });
    holder.service = service(p);
    render(<SecurityGroup />);

    fireEvent.click(await screen.findByRole('checkbox'));

    expect(p.setEnabled).toHaveBeenCalledWith(true);
    await vi.waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
        true
      )
    );
  });

  it('stays off when the unlock prompt is cancelled', async () => {
    const p = provider({ available: true, enabled: false }, false);
    holder.service = service(p);
    render(<SecurityGroup />);

    fireEvent.click(await screen.findByRole('checkbox'));

    // the switch follows the prompt's outcome, not the tap
    await vi.waitFor(() => expect(p.setEnabled).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(screen.queryByRole('checkbox')).toBeTruthy());
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('explains, and will not enable, when the phone has no screen lock', async () => {
    const p = provider({ available: false, enabled: false });
    holder.service = service(p);
    render(<SecurityGroup />);

    expect(
      await screen.findByText(
        'com.notesgraph.mobile.setting.security.app-lock.unavailable'
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(p.setEnabled).not.toHaveBeenCalled();
  });
});
