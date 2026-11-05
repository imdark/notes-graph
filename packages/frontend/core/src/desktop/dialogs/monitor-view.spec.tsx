/**
 * @vitest-environment happy-dom
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const tokens = vi.hoisted(() => ({
  MonitorsService: class MonitorsService {},
  RemoteAgentRunnerService: class RemoteAgentRunnerService {},
  AgentExecutorService: class AgentExecutorService {},
  AgentRunLogsStore: class AgentRunLogsStore {},
  WorkspaceDialogService: class WorkspaceDialogService {},
  WorkbenchService: class WorkbenchService {},
  WorkspaceService: class WorkspaceService {},
}));
const services = vi.hoisted(() => new Map<unknown, unknown>());
const chatProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('@notesgraph/infra', () => ({
  useService: (token: unknown) => services.get(token),
  useLiveData: (live: { value: unknown }) => live.value,
}));
vi.mock('@notesgraph/component', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Modal: ({ open, title, description, children }: any) =>
    open ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    ) : null,
  RadioGroup: ({ items, onChange }: any) => (
    <div>
      {items.map((item: { value: string; label: string }) => (
        <button key={item.value} onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@notesgraph/core/modules/agents', () => ({
  ...tokens,
  RESEARCH_MODEL: 'research',
  forkTranscript: (log: string) => log,
  monitorChatMessages: () => [],
}));
vi.mock('@notesgraph/core/modules/dialogs', () => ({
  WorkspaceDialogService: tokens.WorkspaceDialogService,
}));
vi.mock('@notesgraph/core/modules/workbench', () => ({
  WorkbenchService: tokens.WorkbenchService,
}));
vi.mock('@notesgraph/core/modules/workspace', () => ({
  WorkspaceService: tokens.WorkspaceService,
}));
vi.mock('../pages/workspace/agents/monitors-section', () => ({
  watches: () => 'Agent on laptop · every 1h',
}));
vi.mock('../pages/workspace/detail-page/tabs/agent-run-row', () => ({
  relativeTime: () => '5m ago',
  formatDuration: (ms: number) => `${ms / 1000}s`,
}));
vi.mock('../pages/workspace/detail-page/tabs/agent-log-view', () => ({
  AgentLogView: ({
    log,
    placeholder,
  }: {
    log: string;
    placeholder: string;
  }) => <pre data-testid="log">{log || placeholder}</pre>,
}));
vi.mock('../pages/workspace/detail-page/tabs/agent-side-chat', () => ({
  AgentSideChat: (props: { hint: string; testId: string }): ReactNode => {
    chatProps.current = props;
    return <div data-testid={props.testId}>{props.hint}</div>;
  },
}));

import { ReadingsChart } from './monitor-readings';
import { MonitorViewDialog } from './monitor-view';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;

const reading = (value: string | null, at: number, over = {}) => ({
  value,
  error: null,
  changed: false,
  alerted: false,
  at,
  ...over,
});

const agentMonitor = {
  id: 'm1',
  name: 'GPU price',
  docId: 'd1',
  blockId: 'b1',
  kind: 'agent',
  source: null,
  deviceKey: 'laptop',
  spec: { instructions: 'Find the price.', model: 'claude-code' },
  intervalMinutes: 60,
  condition: { type: 'below', value: 1800 },
  alerts: { inApp: true },
  enabled: true,
  nextRunAt: 2000,
  lastRunAt: 1000,
  lastValue: '1899',
  lastError: null,
  pending: false,
};

const job = (over = {}) => ({
  id: 'j1',
  deviceKey: 'laptop',
  agentId: 'monitor:m1',
  agentName: 'GPU price',
  model: 'claude-code',
  status: 'done',
  result: 'RTX 5090 at $1,899',
  error: null,
  steps: 3,
  tmuxSession: null,
  startedAt: 100,
  finishedAt: 160,
  ...over,
});

const setup = (
  monitor: any,
  {
    readings = [reading('1950', 100), reading('1899', 200, { alerted: true })],
    runs = [job()],
  }: { readings?: any[]; runs?: any[] } = {}
) => {
  const close = vi.fn();
  const forkOf = vi.fn(async () => async function* () {});
  const open = vi.fn();
  const openDoc = vi.fn();
  services.set(tokens.MonitorsService, {
    // eslint-disable-next-line rxjs/finnish -- stands in for the LiveData
    monitors$: { value: [monitor] },
    // eslint-disable-next-line rxjs/finnish -- stands in for the LiveData
    error$: { value: null },
    watch: () => () => {},
    readings: async () => readings,
    runs: async () => runs,
    runNow: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  });
  services.set(tokens.RemoteAgentRunnerService, {
    watch: async function* (_ws: string, id: string) {
      yield { job: runs.find(r => r.id === id), logDelta: `log of ${id}` };
    },
    get: async (_ws: string, id: string) => runs.find(r => r.id === id),
  });
  services.set(tokens.AgentExecutorService, { forkOf });
  services.set(tokens.AgentRunLogsStore, {
    getChat: async () => undefined,
    putChat: async () => {},
  });
  services.set(tokens.WorkspaceDialogService, { open });
  services.set(tokens.WorkbenchService, { workbench: { openDoc } });
  services.set(tokens.WorkspaceService, { workspace: { id: 'ws1' } });
  render(<MonitorViewDialog close={close} monitorId={monitor.id} />);
  return { close, forkOf, open, openDoc };
};

afterEach(() => {
  cleanup();
  chatProps.current = null;
});

describe('ReadingsChart', () => {
  test('draws one line, marks alerts, and shows the reading under the pointer', () => {
    render(
      <ReadingsChart
        readings={[
          reading('1899', 300, { alerted: true }),
          reading('1950', 200),
          reading(null, 150, { error: 'timed out' }),
          reading('2000', 100),
        ]}
      />
    );
    const line = screen.getByTestId('monitor-view-chart-line');
    expect(line.getAttribute('d')?.match(/[ML]/g)).toHaveLength(3);
    expect(screen.getAllByTestId('monitor-view-chart-alert')).toHaveLength(1);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '3 readings from 1899 to 2000, latest 1899'
    );

    // Far right: the newest reading, which alerted.
    fireEvent.pointerMove(screen.getByRole('img'), { clientX: 10_000 });
    expect(
      screen.getByTestId('monitor-view-chart-tooltip').textContent
    ).toContain('1899 · alerted');
    fireEvent.pointerLeave(screen.getByRole('img'));
    expect(screen.queryByTestId('monitor-view-chart-tooltip')).toBeNull();
  });

  test('text readings say why there is no chart', () => {
    render(<ReadingsChart readings={[reading('in stock', 1)]} />);
    expect(screen.getByTestId('monitor-view-no-chart').textContent).toMatch(
      /aren't numbers/
    );
  });
});

describe('MonitorViewDialog', () => {
  test('opens on the chart and readings of the monitor', async () => {
    setup(agentMonitor);
    expect(screen.getByRole('heading').textContent).toBe(
      '📡 GPU price · Watching'
    );
    await screen.findByTestId('monitor-view-chart');
    expect(screen.getByTestId('monitor-view-readings').textContent).toContain(
      '1899 · alerted'
    );
  });

  test('the Log tab shows the latest run, and another one when picked', async () => {
    setup(agentMonitor, {
      runs: [job(), job({ id: 'j0', status: 'error', error: 'offline' })],
    });
    await screen.findByTestId('monitor-view-chart');
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() =>
      expect(screen.getByTestId('log').textContent).toBe('log of j1')
    );
    expect(screen.getByText('RTX 5090 at $1,899')).toBeTruthy();
    fireEvent.change(screen.getByTestId('monitor-view-run-picker'), {
      target: { value: 'j0' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('log').textContent).toBe('log of j0')
    );
    expect(screen.getByText('offline')).toBeTruthy();
  });

  test('a web check has no log to show', async () => {
    setup(
      { ...agentMonitor, kind: 'check', source: 'url', deviceKey: null },
      { runs: [] }
    );
    await screen.findByTestId('monitor-view-chart');
    fireEvent.click(screen.getByText('Log'));
    expect(screen.getByTestId('monitor-view-no-log')).toBeTruthy();
  });

  test('Setup runs it now, and Edit setup hands over to the editor', async () => {
    const { close, open } = setup(agentMonitor);
    await screen.findByTestId('monitor-view-chart');
    fireEvent.click(screen.getByText('Setup'));
    expect(screen.getByText('Find the price.')).toBeTruthy();
    expect(screen.getByText('Alerts when it goes below 1800')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('monitor-view-run-now'));
    });
    const monitors = services.get(tokens.MonitorsService) as any;
    expect(monitors.runNow).toHaveBeenCalledWith('m1');
    fireEvent.click(screen.getByTestId('monitor-view-edit'));
    expect(close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('monitor-editor', {
      docId: 'd1',
      blockId: 'b1',
      monitorId: 'm1',
    });
  });

  test('Ask talks to the agent that ran it, on its device', async () => {
    const { forkOf } = setup(agentMonitor);
    await screen.findByTestId('monitor-view-chart');
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByTestId('monitor-view-ask');
    expect(chatProps.current.hint).toMatch(
      /agent that runs this monitor, on laptop/
    );
    await chatProps.current.openModel();
    expect(forkOf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'j1', agentId: 'monitor:m1' }),
      expect.any(Function)
    );
  });

  test('Ask on a web check goes to the server model', async () => {
    setup(
      { ...agentMonitor, kind: 'check', source: 'url', deviceKey: null },
      { runs: [] }
    );
    await screen.findByTestId('monitor-view-chart');
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByTestId('monitor-view-ask');
    expect(chatProps.current.openModel).toBeUndefined();
    expect(chatProps.current.hint).toMatch(/server’s model/);
  });
});
