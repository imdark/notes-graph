import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { ArrowLeftBigIcon, KeyboardIcon } from '@blocksuite/icons/lit';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph-shared/commands';
import { type VirtualKeyboardProviderWithAction } from '@blocksuite/notesgraph-shared/services';
import {
  BlockComponent,
  PropTypes,
  requiredProperties,
  ShadowlessElement,
} from '@blocksuite/std';
import { INLINE_ROOT_ATTR } from '@blocksuite/std/inline';
import { effect, type Signal, signal } from '@preact/signals-core';
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';

import type {
  KeyboardIconType,
  KeyboardToolbarConfig,
  KeyboardToolbarContext,
  KeyboardToolbarItem,
  KeyboardToolPanelConfig,
} from './config';
import { keyboardToolbarStyles } from './styles';
import {
  isKeyboardSubToolBarConfig,
  isKeyboardToolBarActionItem,
  isKeyboardToolPanelConfig,
} from './utils';

export const NOTESGRAPH_KEYBOARD_TOOLBAR = 'notesgraph-keyboard-toolbar';

/**
 * Client rect of the caret (focus end of the native selection) when it sits
 * inside `block`, or null if there is no usable caret there.
 */
function getCaretRect(block: Element): DOMRect | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode)
    return null;
  if (!block.contains(selection.focusNode)) return null;

  const range = document.createRange();
  range.setStart(selection.focusNode, selection.focusOffset);
  range.collapse(true);

  // A collapsed range has no box in some engines (e.g. at the start of an
  // empty text node); its line rect is still in getClientRects().
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect.height === 0) return null;
  return rect;
}

@requiredProperties({
  config: PropTypes.object,
  rootComponent: PropTypes.instanceOf(BlockComponent),
})
export class NotesGraphKeyboardToolbar extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = keyboardToolbarStyles;

  private readonly _expanded$ = signal(false);

  get std() {
    return this.rootComponent.std;
  }

  get panelOpened() {
    return this._currentPanelIndex$.value !== -1;
  }

  /**
   * How far the window has already shrunk for the virtual keyboard. On Android
   * (adjustResize) it shrinks by the whole keyboard; on iOS the keyboard is
   * drawn over the page and nothing shrinks.
   */
  private readonly _viewportShrink$ = signal(0);

  private _fullViewport = { width: 0, height: 0 };

  private readonly _measureViewport = () => {
    const { innerWidth: width, innerHeight: height } = window;
    // A new width means a rotation or a resized window: start over.
    if (width !== this._fullViewport.width) {
      this._fullViewport = { width, height };
    } else if (height > this._fullViewport.height) {
      this._fullViewport.height = height;
    }
    const shrink = Math.max(0, this._fullViewport.height - height);
    if (shrink === this._viewportShrink$.peek()) return;
    this._viewportShrink$.value = shrink;
    // The window just shrank (or grew back) for the keyboard: keep the line
    // being edited in view of the space that's left.
    if (shrink > 0 && this.isConnected) {
      requestAnimationFrame(() => this._scrollCurrentBlockIntoView());
    }
  };

  private get _keyboardHeight() {
    return this.keyboard.staticHeight$.value !== 0
      ? this.keyboard.staticHeight$.value
      : 330;
  }

  /**
   * How much of the window the virtual keyboard covers: what it didn't
   * already take by shrinking the window. Zero where the window shrinks for
   * the whole keyboard, the full keyboard where it is drawn over the page.
   */
  private get _keyboardOverlap() {
    return Math.max(0, this._keyboardHeight - this._viewportShrink$.value);
  }

  private get panelHeight() {
    if (!this._expanded$.value) return this.keyboard.appTabSafeArea$.value;
    if (this.panelOpened) return `${this._keyboardHeight}px`;
    // With the keyboard up and no panel, the panel only holds the toolbar above
    // the keyboard by sitting behind it. Where the window already shrank for
    // the keyboard there is nothing to sit behind: a full-height panel would
    // cover the lines being typed.
    return `${this._keyboardOverlap}px`;
  }

  private get panelPaddingBottom() {
    const keyboardShrankWindow =
      this._expanded$.value &&
      !this.panelOpened &&
      this._viewportShrink$.value > 0;
    return keyboardShrankWindow ? '0px' : this.keyboard.appTabSafeArea$.value;
  }

  /**
   * Prevent flickering during keyboard opening
   */
  private _resetPanelIndexTimeoutId: ReturnType<typeof setTimeout> | null =
    null;
  private readonly _closeToolPanel = () => {
    if (!this.keyboard.visible$.peek()) this.keyboard.show();

    if (this._resetPanelIndexTimeoutId) {
      clearTimeout(this._resetPanelIndexTimeoutId);
      this._resetPanelIndexTimeoutId = null;
    }
    this._resetPanelIndexTimeoutId = setTimeout(() => {
      this._currentPanelIndex$.value = -1;
    }, 100);
  };

  private readonly _currentPanelIndex$ = signal(-1);

  private readonly _goPrevToolbar = () => {
    if (!this._isSubToolbarOpened) return;

    if (this.panelOpened) this._closeToolPanel();

    this._path$.value = this._path$.value.slice(0, -1);
  };

  private readonly _handleItemClick = (
    item: KeyboardToolbarItem,
    index: number
  ) => {
    if (isKeyboardToolBarActionItem(item)) {
      item.action &&
        Promise.resolve(item.action(this._context)).catch(console.error);
    } else if (isKeyboardSubToolBarConfig(item)) {
      this._closeToolPanel();
      this._path$.value = [...this._path$.value, index];
    } else if (isKeyboardToolPanelConfig(item)) {
      if (this._currentPanelIndex$.value === index) {
        this._closeToolPanel();
      } else {
        if (this._resetPanelIndexTimeoutId) {
          clearTimeout(this._resetPanelIndexTimeoutId);
          this._resetPanelIndexTimeoutId = null;
        }
        this._currentPanelIndex$.value = index;
        this.keyboard.hide();
        this._scrollCurrentBlockIntoView();
      }
    }
    this._lastActiveItem$.value = item;
  };

  private readonly _lastActiveItem$ = signal<KeyboardToolbarItem | null>(null);

  private readonly _path$ = signal<number[]>([]);

  private readonly _scrollCurrentBlockIntoView = () => {
    this.std.command
      .chain()
      .pipe(getSelectedModelsCommand)
      .pipe(({ selectedModels }) => {
        if (!selectedModels?.length) return;

        const block = this.std.view.getBlock(selectedModels[0].id);
        if (!block) return;

        // Where the line must stay above. With a panel open, that's the top
        // of the toolbar. Otherwise it's the toolbar's bar sitting on top of
        // the keyboard: the visual viewport's bottom, less whatever part of
        // the keyboard is drawn over the window rather than shrinking it.
        // That's right both where the keyboard covers the page and where the
        // window shrinks for it. The toolbar's own box is wrong while the
        // window resizes: its panel is keyboard-tall for a moment.
        const bar = this.querySelector('.keyboard-toolbar');
        const viewport = window.visualViewport;
        const keyboardOverlap = this.keyboard.visible$.peek()
          ? this._keyboardOverlap
          : 0;
        // That estimate is too high wherever the keyboard height and the
        // window's shrink disagree (a phone whose reported keyboard height
        // doesn't match how far the window shrank), and on iOS, where the
        // visual viewport already ends at the keyboard so subtracting the
        // overlap counts the keyboard twice. Too high, and tapping a word in
        // the lower part of the page scrolled it, though it was in plain
        // view. The bar's own box errs the same way (too high, during a
        // resize), so the lower of the two is the line.
        const barRect = bar?.getBoundingClientRect();
        const y1 =
          this.panelOpened || !barRect || !viewport
            ? this.getBoundingClientRect().y
            : Math.max(
                viewport.offsetTop +
                  viewport.height -
                  keyboardOverlap -
                  barRect.height,
                barRect.top
              );
        const gap = 8;

        // Reveal the caret, not the whole block. Aligning the block's
        // bottom above the toolbar made every tap into a tall block (a long
        // wrapped paragraph, or a list item with nested children — whose
        // component contains them) jump the page so the tapped line ended
        // up far above the viewport.
        const caretRect = getCaretRect(block);
        // Without a caret in the block (the native selection hasn't caught
        // up with a tap yet), fall back to the block's own text, not the
        // whole component: a list item's or toggle's component holds its
        // children, and its bottom sent the page far from the tapped line.
        const targetRect =
          caretRect ??
          (
            block.querySelector(`[${INLINE_ROOT_ATTR}]`) ?? block
          ).getBoundingClientRect();
        const y2 = targetRect.bottom;

        if (y2 < y1 - gap) return;

        // Never scroll the target's top out of view.
        const top = targetRect.top;
        const delta = Math.min(y2 - y1 + gap, top - gap);
        if (delta <= 0) return;

        scrollTo({
          top: window.scrollY + delta,
          behavior: 'instant',
        });
      })
      .run();
  };

  private get _context(): KeyboardToolbarContext {
    return {
      std: this.std,
      rootComponent: this.rootComponent,
      closeToolPanel: () => {
        this._closeToolPanel();
      },
    };
  }

  private get _currentPanelConfig(): KeyboardToolPanelConfig | null {
    if (!this.panelOpened) return null;

    const result = this._currentToolbarItems[this._currentPanelIndex$.value];

    return isKeyboardToolPanelConfig(result) ? result : null;
  }

  private get _currentToolbarItems(): KeyboardToolbarItem[] {
    let items = this.config.items;
    for (const index of this._path$.value) {
      if (isKeyboardSubToolBarConfig(items[index])) {
        items = items[index].items;
      } else {
        break;
      }
    }

    return items.filter(item =>
      isKeyboardToolBarActionItem(item)
        ? (item.showWhen?.(this._context) ?? true)
        : true
    );
  }

  private get _isSubToolbarOpened() {
    return this._path$.value.length > 0;
  }

  private _renderIcon(icon: KeyboardIconType) {
    return typeof icon === 'function' ? icon(this._context) : icon;
  }

  private _renderItem(item: KeyboardToolbarItem, index: number) {
    let icon = item.icon;
    let style = styleMap({});
    const disabled =
      ('disableWhen' in item && item.disableWhen?.(this._context)) ?? false;

    if (isKeyboardToolBarActionItem(item)) {
      const background =
        typeof item.background === 'function'
          ? item.background(this._context)
          : item.background;
      if (background)
        style = styleMap({
          background: background,
        });
    } else if (isKeyboardToolPanelConfig(item)) {
      const { activeIcon, activeBackground } = item;
      const active = this._currentPanelIndex$.value === index;

      if (active && activeIcon) icon = activeIcon;
      if (active && activeBackground)
        style = styleMap({ background: activeBackground });
    }

    return html`<icon-button
      size="36px"
      style=${style}
      ?disabled=${disabled}
      @click=${() => {
        this._handleItemClick(item, index);
      }}
    >
      ${this._renderIcon(icon)}
    </icon-button>`;
  }

  private _renderItems() {
    if (!this.std.event.active$.value)
      return html`<div class="item-container"></div>`;

    const goPrevToolbarAction = when(
      this._isSubToolbarOpened,
      () =>
        html`<icon-button size="36px" @click=${this._goPrevToolbar}>
          ${ArrowLeftBigIcon()}
        </icon-button>`
    );

    return html`<div class="item-container">
      ${goPrevToolbarAction}
      ${repeat(this._currentToolbarItems, (item, index) =>
        this._renderItem(item, index)
      )}
    </div>`;
  }

  private _renderKeyboardButton() {
    return html`<div class="keyboard-container">
      <icon-button
        size="36px"
        @click=${() => {
          if (this.keyboard.staticHeight$.value === 0) {
            this._closeToolPanel();
            return;
          }
          if (this.keyboard.visible$.peek()) {
            this.keyboard.hide();
          } else {
            this.keyboard.show();
          }
        }}
      >
        ${KeyboardIcon()}
      </icon-button>
    </div>`;
  }

  override connectedCallback() {
    super.connectedCallback();

    this._measureViewport();
    this.disposables.addFromEvent(window, 'resize', this._measureViewport);

    // There are two cases that `_expanded$` will be true:
    // 1. when virtual keyboard is opened, the panel need to be expanded and overlapped by the keyboard,
    // so that the toolbar will be on the top of the keyboard.
    // 2. the panel is opened, whether the keyboard is closed or not exists (e.g. a physical keyboard connected)
    //
    // There is one case that `_expanded$` will be false:
    // 1. the panel is closed, and the keyboard is closed, the toolbar will be rendered at the bottom of the viewport
    this._disposables.add(
      effect(() => {
        if (this.keyboard.visible$.value || this.panelOpened) {
          this._expanded$.value = true;
        } else {
          this._expanded$.value = false;
        }
      })
    );

    // prevent editor blur when click item in toolbar
    this.disposables.addFromEvent(this, 'pointerdown', e => {
      e.preventDefault();
    });

    this.disposables.add(
      effect(() => {
        const std = this.rootComponent.std;
        void std.selection.value;
        // wait cursor updated
        requestAnimationFrame(() => {
          this._scrollCurrentBlockIntoView();
        });
      })
    );

    // Typing moves the caret down (wrapped lines, new lines) without always
    // changing the std selection, so follow the native caret as well.
    let caretFrame = 0;
    this.disposables.addFromEvent(document, 'selectionchange', () => {
      if (caretFrame) return;
      caretFrame = requestAnimationFrame(() => {
        caretFrame = 0;
        this._scrollCurrentBlockIntoView();
      });
    });
    this.disposables.add(() => {
      if (caretFrame) cancelAnimationFrame(caretFrame);
    });

    this.disposables.add(
      effect(() => {
        // sometime the keyboard will auto show when user click into different paragraph in Android,
        // so we need to close the tool panel explicitly when the keyboard is visible
        if (this.keyboard.visible$.value) {
          this._closeToolPanel();
        }
      })
    );

    this._watchAutoShow();

    this.disposables.add(() => {
      if (this._resetPanelIndexTimeoutId) {
        clearTimeout(this._resetPanelIndexTimeoutId);
        this._resetPanelIndexTimeoutId = null;
      }
    });
  }

  private _watchAutoShow() {
    const autoShowSubToolbars: { path: number[]; signal: Signal<boolean> }[] =
      [];

    const traverse = (item: KeyboardToolbarItem, path: number[]) => {
      if (isKeyboardSubToolBarConfig(item) && item.autoShow) {
        autoShowSubToolbars.push({
          path,
          signal: item.autoShow(this._context),
        });

        item.items.forEach((subItem, index) => {
          traverse(subItem, [...path, index]);
        });
      }
    };
    this.config.items.forEach((item, index) => {
      traverse(item, [index]);
    });

    const samePath = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    let prevPath = this._path$.peek();
    this.disposables.add(
      effect(() => {
        autoShowSubToolbars.forEach(({ path, signal }) => {
          if (signal.value) {
            if (samePath(this._path$.peek(), path)) return;

            prevPath = this._path$.peek();
            this._path$.value = path;
          } else {
            this._path$.value = prevPath;
          }
        });
      })
    );
  }

  override firstUpdated() {
    // workaround for the virtual keyboard showing transition animation
    const timeoutId = setTimeout(() => {
      this._scrollCurrentBlockIntoView();
    }, 700);
    this.disposables.add(() => {
      clearTimeout(timeoutId);
    });
  }

  override render() {
    return html`
      <div class="keyboard-toolbar">
        ${this._renderItems()}
        <div class="divider"></div>
        ${this._renderKeyboardButton()}
      </div>
      <notesgraph-keyboard-tool-panel
        .config=${this._currentPanelConfig}
        .context=${this._context}
        style=${styleMap({
          height: this.panelHeight,
          paddingBottom: this.panelPaddingBottom,
        })}
      ></notesgraph-keyboard-tool-panel>
    `;
  }

  @property({ attribute: false })
  accessor keyboard!: VirtualKeyboardProviderWithAction;

  @property({ attribute: false })
  accessor config!: KeyboardToolbarConfig;

  @property({ attribute: false })
  accessor rootComponent!: BlockComponent;
}
