import { OpenIcon } from '@blocksuite/notesgraph-components/icons';
import type {
  EmbedFigmaModel,
  EmbedFigmaStyles,
} from '@blocksuite/notesgraph-model';
import { BlockSelection } from '@blocksuite/std';
import { html, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { EmbedBlockComponent } from '../common/embed-block-element.js';
import { FigmaIcon, styles } from './styles.js';

export class EmbedFigmaBlockComponent extends EmbedBlockComponent<EmbedFigmaModel> {
  static override styles = styles;

  override _cardStyle: (typeof EmbedFigmaStyles)[number] = 'figma';

  open = () => {
    let link = this.model.props.url;
    if (!link.match(/^[a-zA-Z]+:\/\//)) {
      link = 'https://' + link;
    }
    window.open(link, '_blank');
  };

  refreshData = () => {};

  private _handleDoubleClick(event: MouseEvent) {
    event.stopPropagation();
    this.open();
  }

  private _selectBlock() {
    const selectionManager = this.host.selection;
    const blockSelection = selectionManager.create(BlockSelection, {
      blockId: this.blockId,
    });
    selectionManager.setGroup('note', [blockSelection]);
  }

  protected _handleClick(event: MouseEvent) {
    event.stopPropagation();
    this._selectBlock();
  }

  override connectedCallback() {
    super.connectedCallback();
    this._cardStyle = this.model.props.style;

    if (!this.model.props.title) {
      this.store.withoutTransact(() => {
        this.store.updateBlock(this.model, {
          title: 'Figma',
        });
      });
    }

    this.disposables.add(
      this.model.propsUpdated.subscribe(({ key }) => {
        if (key === 'url') {
          this.refreshData();
        }
      })
    );
  }

  override renderBlock() {
    const { title, description, url } = this.model.props;
    const titleText = title ?? 'Figma';

    return this.renderEmbed(
      () => html`
        <div
          class=${classMap({
            'notesgraph-embed-figma-block': true,
            selected: this.selected$.value,
          })}
          @click=${this._handleClick}
          @dblclick=${this._handleDoubleClick}
        >
          <div class="notesgraph-embed-figma">
            <div class="notesgraph-embed-figma-iframe-container">
              <iframe
                src=${`https://www.figma.com/embed?embed_host=blocksuite&url=${url}`}
                sandbox="allow-same-origin allow-scripts allow-presentation"
                allow="fullscreen"
                loading="lazy"
                credentialless
              ></iframe>

              <!-- overlay to prevent the iframe from capturing pointer events -->
              <div
                class=${classMap({
                  'notesgraph-embed-figma-iframe-overlay': true,
                  hide: !this.showOverlay$.value,
                })}
              ></div>
            </div>
          </div>
          <div class="notesgraph-embed-figma-content">
            <div class="notesgraph-embed-figma-content-header">
              <div class="notesgraph-embed-figma-content-title-icon">
                ${FigmaIcon}
              </div>

              <div class="notesgraph-embed-figma-content-title-text">
                ${titleText}
              </div>
            </div>

            ${description
              ? html`<div class="notesgraph-embed-figma-content-description">
                  ${description}
                </div>`
              : nothing}

            <div class="notesgraph-embed-figma-content-url" @click=${this.open}>
              <span>www.figma.com</span>

              <div class="notesgraph-embed-figma-content-url-icon">
                ${OpenIcon}
              </div>
            </div>
          </div>
        </div>
      `
    );
  }
}
