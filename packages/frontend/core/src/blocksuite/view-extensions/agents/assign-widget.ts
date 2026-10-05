import { type Container, createIdentifier } from '@blocksuite/global/di';
import { PlusIcon, ToolIcon } from '@blocksuite/icons/lit';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph/components/context-menu';
import {
  BLOCK_ID_ATTR,
  TextSelection,
  WidgetComponent,
  WidgetViewExtension,
} from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import {
  type Agent,
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
  isOpenTask,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import type { FrameworkProvider } from '@notesgraph/infra';
import { css, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { literal, unsafeStatic } from 'lit/static-html.js';

/** Bridges the core framework into the editor so the widget can reach services. */
const AgentsFrameworkIdentifier = createIdentifier<FrameworkProvider>(
  'NotesGraphAgentsFramework'
);

const WIDGET_TAG = 'notesgraph-agent-assign-widget';

/** Gap between the end of the line's text and the button. */
const GAP_PX = 4;

/**
 * A small button floating at the end of a to-do line that no agent is on yet,
 * offering to hand the task to one: pick an existing agent, or make a new one
 * and hand it to that.
 *
 * Shown while the line is hovered or the caret is in it — on a phone, tapping
 * into the line is what brings it up. Once a run is asked for, the task goes
 * QUEUED (see AgentTaskClaimService), which is no longer open, so the button
 * goes away on its own; it comes back if the task is handed back to to-do.
 */
export class AgentAssignWidget extends WidgetComponent {
  static override styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }
    .ng-agent-assign {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 20px;
      padding: 0 4px;
      border: 1px solid var(--notesgraph-border-color);
      border-radius: 10px;
      background: var(--notesgraph-background-primary-color);
      color: var(--notesgraph-text-secondary-color);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      box-shadow: var(--notesgraph-shadow-1);
    }
    .ng-agent-assign:hover,
    .ng-agent-assign[data-open] {
      color: var(--notesgraph-primary-color);
      border-color: var(--notesgraph-primary-color);
    }
    .ng-agent-assign svg {
      width: 14px;
      height: 14px;
    }
  `;

  private _framework: FrameworkProvider | null = null;

  @state()
  private accessor _hovered = false;

  @state()
  private accessor _caretIn = false;

  @state()
  private accessor _menuOpen = false;

  /** Bumped when something the open-task check reads changes. */
  @state()
  private accessor _version = 0;

  private readonly _bump = () => {
    this._version++;
  };

  private get _target(): AgentTarget {
    return {
      kind: 'block',
      docId: this.std.store.id,
      blockId: this.model.id,
    };
  }

  override connectedCallback() {
    super.connectedCallback();
    const framework = this.std.getOptional(AgentsFrameworkIdentifier);
    if (!framework) return;
    this._framework = framework;

    const sessions = framework.get(AgentRunSessionService);
    this._disposables.add(sessions.sessions$.subscribe(this._bump));
    this._disposables.add(sessions.queue$.subscribe(this._bump));
    this._disposables.add(this.model.propsUpdated.subscribe(this._bump));

    const yText = this.model.text?.yText;
    if (yText) {
      yText.observe(this._bump);
      this._disposables.add(() => yText.unobserve(this._bump));
    }

    this._disposables.add(
      this.std.selection.slots.changed.subscribe(() => {
        const text = this.std.selection.find(TextSelection);
        this._caretIn =
          !!text &&
          (text.from.blockId === this.model.id ||
            text.to?.blockId === this.model.id);
      })
    );

    // Hovering a nested child item is hovering that item, not this one. The
    // widget renders inside its block, which may not be registered in the
    // view yet, so find it in the DOM.
    const block = this.parentElement?.closest(`[${BLOCK_ID_ATTR}]`);
    if (block) {
      const onOver = (e: Event) => {
        const el = e.target as Element | null;
        this._hovered = el?.closest(`[${BLOCK_ID_ATTR}]`) === block;
      };
      const onLeave = () => {
        this._hovered = false;
      };
      block.addEventListener('pointerover', onOver);
      block.addEventListener('pointerleave', onLeave);
      this._disposables.add(() => {
        block.removeEventListener('pointerover', onOver);
        block.removeEventListener('pointerleave', onLeave);
      });
    }
  }

  private _shouldShow(): boolean {
    if (!this._framework || this.store.readonly) return false;
    if (!this._hovered && !this._caretIn && !this._menuOpen) return false;
    if (!isOpenTask(this.model)) return false;
    return !this._framework.get(AgentRunSessionService).isBusyOn(this._target);
  }

  override updated() {
    // The line's text re-renders on its own schedule after an edit; measure
    // once it has, not against the text as it was.
    requestAnimationFrame(() => this._place());
  }

  /** Sit just after the last character of the line's own text. */
  private _place() {
    const button =
      this.renderRoot.querySelector<HTMLElement>('.ng-agent-assign');
    const parent = this.offsetParent;
    // The block's own line comes before its children, so the first rich text
    // in it is this line's.
    const editor = this.parentElement
      ?.closest(`[${BLOCK_ID_ATTR}]`)
      ?.querySelector('rich-text .inline-editor');
    if (!button || !parent || !editor) return;

    const range = document.createRange();
    range.selectNodeContents(editor);
    const rects = range.getClientRects();
    const end = rects[rects.length - 1] ?? editor.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    const width = button.offsetWidth;
    const height = button.offsetHeight;

    // A line that runs to the edge has no room after it; tuck the button
    // against the edge instead of letting it hang off the page.
    const left = Math.min(end.right - box.left + GAP_PX, box.width - width);
    const top = end.top - box.top + (end.height - height) / 2;
    this.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
  }

  private readonly _openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const framework = this._framework;
    if (!framework) return;

    const agents = framework.get(AgentsService).agentsFor$('block').value;
    this._menuOpen = true;
    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        title: { text: 'Assign to agent' },
        onClose: () => {
          this._menuOpen = false;
        },
        items: [
          menu.group({
            items: agents.map(agent =>
              menu.action({
                name: agent.name,
                prefix: agent.emoji
                  ? html`<span>${agent.emoji}</span>`
                  : ToolIcon(),
                select: () => this._assign(agent),
              })
            ),
          }),
          menu.group({
            items: [
              menu.action({
                name: 'New agent…',
                prefix: PlusIcon(),
                select: () => this._createAndAssign(),
              }),
            ],
          }),
        ],
      },
    });
  };

  private _assign(agent: Agent) {
    const framework = this._framework;
    if (!framework) return;
    // The side panel is where a run shows its progress; the phone has none,
    // and there the task's QUEUED chip is the sign it was taken.
    if (!BUILD_CONFIG.isMobileEdition) {
      const workbench = framework.get(WorkbenchService).workbench;
      workbench.openSidebar();
      workbench.activeView$.value.activeSidebarTab('agents');
    }
    void framework.get(AgentRunSessionService).start(agent, this._target);
  }

  private _createAndAssign() {
    const framework = this._framework;
    if (!framework) return;
    framework.get(WorkspaceDialogService).open('agent-editor', {}, agent => {
      if (agent) this._assign(agent);
    });
  }

  override render() {
    // Read so a status, run or text change re-renders.
    void this._version;
    if (!this._shouldShow()) return nothing;
    return html`<span
      class="ng-agent-assign"
      role="button"
      contenteditable="false"
      title="Assign to an agent"
      data-testid="agent-assign-button"
      ?data-open=${this._menuOpen}
      @pointerdown=${(e: PointerEvent) => e.preventDefault()}
      @click=${this._openMenu}
      >${ToolIcon()}${PlusIcon()}</span
    >`;
  }
}

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, AgentAssignWidget);
}

/**
 * Editor extensions for the assign-to-agent button: a DI binding that exposes
 * the framework, plus the widget on the blocks a task can live in — list items
 * (checkboxes) and paragraphs carrying an org status.
 */
export function agentAssignWidgetExtensions(
  framework: FrameworkProvider
): ExtensionType[] {
  return [
    {
      setup: (di: Container) => {
        di.addImpl(AgentsFrameworkIdentifier, () => framework);
      },
    },
    WidgetViewExtension(
      'notesgraph:paragraph',
      WIDGET_TAG,
      literal`${unsafeStatic(WIDGET_TAG)}`
    ),
    WidgetViewExtension(
      'notesgraph:list',
      WIDGET_TAG,
      literal`${unsafeStatic(WIDGET_TAG)}`
    ),
  ];
}
