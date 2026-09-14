import { type Container, createIdentifier } from '@blocksuite/global/di';
import {
  WidgetComponent,
  WidgetViewExtension,
} from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';
import { css, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { WorkspaceDialogService } from '../../../modules/dialogs';
import {
  describeRule,
  formatTimeRange,
  fromISODate,
  type ScheduleRule,
  ScheduleService,
} from '../../../modules/schedule';

/** Bridges the core framework into the editor so widgets can reach services. */
export const ScheduleFrameworkIdentifier = createIdentifier<FrameworkProvider>(
  'NotesGraphScheduleFramework'
);

const WIDGET_TAG = 'notesgraph-block-schedule-widget';

interface ScheduleEntry {
  rule?: ScheduleRule;
  date?: string;
  time?: string;
  endTime?: string;
  text: string;
}

/**
 * Renders a clickable, dotted-underline human time stamp on a scheduled
 * paragraph/list block; clicking it opens the date+time editor.
 *
 * NOTE: rendering/positioning is verified by typecheck only (not run); the
 * inline placement may need a CSS tweak once exercised in the editor.
 */
export class BlockScheduleWidget extends WidgetComponent {
  static override styles = css`
    /* sit at the trailing (right) edge of the block, aligned to its first line,
       rather than flowing below it */
    :host {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      align-items: center;
      height: 1.6em;
      z-index: 1;
      pointer-events: none;
    }
    .ng-schedule-chip {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      line-height: 1;
      color: var(--notesgraph-text-secondary-color);
      text-decoration: underline dotted;
      text-underline-offset: 3px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      pointer-events: auto;
      padding: 0 2px;
      background: var(--notesgraph-background-primary-color);
      border-radius: 4px;
    }
    .ng-schedule-chip:hover {
      color: var(--notesgraph-primary-color);
    }
  `;

  private _framework: FrameworkProvider | null = null;

  @state()
  private accessor entry: ScheduleEntry | undefined = undefined;

  override firstUpdated() {
    const framework = this.std.getOptional(ScheduleFrameworkIdentifier);
    if (!framework) return;
    this._framework = framework;
    const scheduleService = framework.get(ScheduleService);
    const docId = this.std.store.id;
    const blockId = this.model.id;
    this._disposables.add(
      scheduleService.blockScheduleEntry$(docId, blockId).subscribe(value => {
        this.entry = value as ScheduleEntry | undefined;
      })
    );
  }

  private readonly _openEditor = (e: Event) => {
    e.stopPropagation();
    if (!this._framework) return;
    const rect = this.getBoundingClientRect();
    const text =
      (this.model as { text?: { toString(): string } }).text?.toString() ?? '';
    this._framework.get(WorkspaceDialogService).open('block-schedule', {
      docId: this.std.store.id,
      blockId: this.model.id,
      text,
      position: [rect.left, rect.bottom, rect.width, 0],
    });
  };

  override render() {
    const entry = this.entry;
    if (!entry || (!entry.date && !entry.rule)) return nothing;
    const time = formatTimeRange(entry.time, entry.endTime);
    let base = '';
    if (entry.rule) {
      base = describeRule(entry.rule);
    } else if (entry.date) {
      base = fromISODate(entry.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    }
    const label = [base, time].filter(Boolean).join(', ');
    if (!label) return nothing;
    return html`<span class="ng-schedule-chip" @click=${this._openEditor}
      >${label}</span
    >`;
  }
}

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, BlockScheduleWidget);
}

/**
 * Editor extensions for the on-block schedule widget: a DI binding that exposes
 * the framework, plus the widget registered on paragraph & list blocks.
 */
export function scheduleWidgetExtensions(
  framework: FrameworkProvider
): ExtensionType[] {
  return [
    {
      setup: (di: Container) => {
        di.addImpl(ScheduleFrameworkIdentifier, () => framework);
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
