import { AiIcon, PlusIcon } from '@blocksuite/icons/lit';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph/components/context-menu';
import { focusTextModel } from '@blocksuite/notesgraph/rich-text';
import type { BlockStdScope } from '@blocksuite/notesgraph/std';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import { IconType } from '@notesgraph/component';
import {
  type Agent,
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
  FleetService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import type { FrameworkProvider } from '@notesgraph/infra';
import { html } from 'lit';

import { addRowAfter } from './add-row';

/**
 * What a line offers from the assign-to-agent pill and, on a phone, the
 * keyboard toolbar: hand the block to an agent, or add a row after it.
 */

/** Longest the menu waits for the machines' health before opening. */
const FLEET_WAIT_MS = 800;

/**
 * The agent's own icon for the menu: its emoji or generated image. Built-in
 * named icons have no lit renderer here, so those keep the generic one.
 */
const agentMenuIcon = (agent: Agent) => {
  const icon = agent.icon;
  if (icon?.type === IconType.Emoji && icon.unicode) {
    return html`<span>${icon.unicode}</span>`;
  }
  if (icon?.type === IconType.Blob && icon.url) {
    return html`<img
      src=${icon.url}
      alt=""
      style="width:1em;height:1em;border-radius:0.15em;object-fit:cover"
    />`;
  }
  return agent.emoji ? html`<span>${agent.emoji}</span>` : AiIcon();
};

export function blockTarget(std: BlockStdScope, model: BlockModel): AgentTarget {
  return { kind: 'block', docId: std.store.id, blockId: model.id };
}

export function assignBlockToAgent(
  framework: FrameworkProvider,
  target: AgentTarget,
  agent: Agent
) {
  // The side panel is where a run shows its progress; the phone has none,
  // and there the task's QUEUED chip is the sign it was taken.
  if (!BUILD_CONFIG.isMobileEdition) {
    const workbench = framework.get(WorkbenchService).workbench;
    workbench.openSidebar();
    workbench.activeView$.value.activeSidebarTab('agents');
  }
  framework
    .get(AgentRunSessionService)
    .start(agent, target)
    .catch(console.error);
}

/**
 * Open the "Assign to agent" menu at `anchor` for `model`: the agents that
 * take a block (machines reported down last), a new agent, or a monitor.
 * `onClose` runs once the menu is gone, chosen from or dismissed.
 */
export function openAssignToAgentMenu({
  framework,
  std,
  model,
  anchor,
  onClose,
}: {
  framework: FrameworkProvider;
  std: BlockStdScope;
  model: BlockModel;
  anchor: HTMLElement;
  onClose?: () => void;
}) {
  const target = blockTarget(std, model);
  const assign = (agent: Agent) =>
    assignBlockToAgent(framework, target, agent);

  // Nothing may have fetched the machines yet this session; wait a moment
  // for them, but open unsorted rather than keep the menu waiting.
  const fleet = framework.get(FleetService);
  Promise.race([
    fleet.ensureLoaded(),
    new Promise(resolve => setTimeout(resolve, FLEET_WAIT_MS)),
  ])
    .then(() => {
      if (!anchor.isConnected) {
        onClose?.();
        return;
      }
      const agents = fleet.downLastNow(
        framework.get(AgentsService).agentsFor$('block').value
      );
      popMenu(popupTargetFromElement(anchor), {
        options: {
          title: { text: 'Assign to agent' },
          onClose,
          items: [
            menu.group({
              items: agents.map(agent =>
                menu.action({
                  name: agent.name,
                  prefix: agentMenuIcon(agent),
                  select: () => assign(agent),
                })
              ),
            }),
            menu.group({
              items: [
                menu.action({
                  name: 'New agent…',
                  prefix: PlusIcon(),
                  select: () => {
                    framework
                      .get(WorkspaceDialogService)
                      .open('agent-editor', {}, agent => {
                        if (agent) assign(agent);
                      });
                  },
                }),
                menu.action({
                  name: 'Monitor…',
                  prefix: html`<span>📡</span>`,
                  select: () => {
                    framework
                      .get(WorkspaceDialogService)
                      .open('monitor-editor', {
                        docId: std.store.id,
                        blockId: model.id,
                        text: model.text?.toString() ?? '',
                      });
                  },
                }),
              ],
            }),
          ],
        },
      });
    })
    .catch(err => {
      onClose?.();
      console.error(err);
    });
}

/** Add an empty row of the same kind after `model` and put the caret in it. */
export function addRowAfterAndFocus(std: BlockStdScope, model: BlockModel) {
  if (std.store.readonly) return;
  const id = addRowAfter(std.store, model);
  if (!id) return;
  const text = std.store.getBlock(id)?.model.text;
  focusTextModel(std, id, text?.length ?? 0);
}
