import { AiIcon, PlusIcon } from '@blocksuite/icons/lit';
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
import { IconType } from '@notesgraph/component';
import {
  type Agent,
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
  isOpenTask,
  isPlainBlock,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import type { FrameworkProvider } from '@notesgraph/infra';
import { css, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { AgentsFrameworkIdentifier } from './framework';
import { lineTextRects } from './line-text-rects';

const WIDGET_TAG = 'notesgraph-agent-assign-widget';

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

/** Gap between the bottom of the line's text and the button. */
const GAP_PX = 2;

/** Least room kept between the end of the line's text and the button. */
const END_GAP_PX = 8;

/**
 * A small button at the end of a to-do line that no agent is on yet,
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
    if (isPlainBlock(this.model)) {
      // A plain block (a long paragraph, say) is not a task, so hovering past
      // it must not litter the note with buttons: offer one only where the
      // caret is, which is what tapping into it does on a phone.
      if (!this._caretIn && !this._menuOpen) return false;
    } else if (!isOpenTask(this.model)) {
      return false;
    }
    return !this._framework.get(AgentRunSessionService).isBusyOn(this._target);
  }

  override updated() {
    // The line's text re-renders on its own schedule after an edit; measure
    // once it has, not against the text as it was.
    requestAnimationFrame(() => this._place());
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._textObserver?.disconnect();
    this._observedEditor = null;
    this._reserveLine(null, 0);
  }

  private _textObserver: MutationObserver | null = null;
  private _observedEditor: HTMLElement | null = null;

  /**
   * The Yjs change fires before the inline editor has put the typed character
   * in the DOM, so measuring after it can see the text as it was. Re-place on
   * the DOM's own change, so the button moves on every character.
   */
  private _watchText(editor: HTMLElement) {
    if (this._observedEditor === editor) return;
    this._textObserver?.disconnect();
    this._observedEditor = editor;
    this._textObserver ??= new MutationObserver(() => this._place());
    this._textObserver.observe(editor, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  /** The block's own line comes before its children, so the first rich text in it is this line's. */
  private _lineEditor(): HTMLElement | null {
    return (
      this.parentElement
        ?.closest(`[${BLOCK_ID_ATTR}]`)
        ?.querySelector<HTMLElement>('rich-text .inline-editor') ?? null
    );
  }

  /** The rich text the room under the line was last made on, to undo it. */
  private _reservedOn: HTMLElement | null = null;

  /**
   * Room under the line's text for the button, so the next line moves down
   * instead of going under it. A margin, not the padding the runs chip uses,
   * so the two don't undo each other's room.
   */
  private _reserveLine(editor: HTMLElement | null, height: number) {
    const richText = height ? editor?.closest('rich-text') : null;
    if (this._reservedOn && this._reservedOn !== richText) {
      this._reservedOn.style.marginBottom = '';
      this._reservedOn = null;
    }
    if (richText instanceof HTMLElement) {
      richText.style.marginBottom = `${height}px`;
      this._reservedOn = richText;
    }
  }

  /**
   * Sit at the right end of the text's last line when there is room after it
   * (an empty line always has room); otherwise drop under the text and push
   * the next line down, so the button never covers text on either line.
   */
  private _place() {
    const button =
      this.renderRoot.querySelector<HTMLElement>('.ng-agent-assign');
    // Every block's widget re-renders on each streamed run event; a hidden
    // one must not force a layout to find that out.
    if (!button) {
      this._reserveLine(null, 0);
      return;
    }
    const parent = this.offsetParent;
    const editor = this._lineEditor();
    if (!parent || !editor) return;
    this._watchText(editor);

    const rects = lineTextRects(editor);
    const line = editor.getBoundingClientRect();
    const end = rects[rects.length - 1];
    const box = parent.getBoundingClientRect();
    const width = button.offsetWidth;
    const height = button.offsetHeight;
    const lastBottom = Math.max(end?.bottom ?? 0, line.bottom);

    let left: number;
    let top: number;
    const visibleBottom = window.visualViewport?.height ?? window.innerHeight;
    if (!end || end.right + END_GAP_PX + width <= line.right) {
      this._reserveLine(null, 0);
      // An empty line has no text box; centre on the editor's one line.
      const row = end ?? line;
      left = line.right - box.left - width;
      top = row.top - box.top + (row.height - height) / 2;
    } else if (lastBottom > visibleBottom) {
      // A long block's last line can sit below the screen (or behind the
      // phone's keyboard), taking the button with it. Pin it to the right end
      // of the first line instead, where the block starts.
      this._reserveLine(null, 0);
      left = line.right - box.left - width;
      top = rects[0].top - box.top;
    } else {
      this._reserveLine(editor, height + GAP_PX);
      left = line.left - box.left;
      top = lastBottom - box.top + GAP_PX;
    }
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
                prefix: agentMenuIcon(agent),
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
    framework
      .get(AgentRunSessionService)
      .start(agent, this._target)
      .catch(console.error);
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
      >${AiIcon()}${PlusIcon()}</span
    >`;
  }
}

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, AgentAssignWidget);
}

/**
 * Editor extensions for the assign-to-agent button: the widget on the blocks
 * a task can live in — list items (checkboxes) and paragraphs carrying an org
 * status. It reaches the framework through AgentsFrameworkIdentifier, which
 * AgentsViewExtension binds.
 */
export function agentAssignWidgetExtensions(): ExtensionType[] {
  return [
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
