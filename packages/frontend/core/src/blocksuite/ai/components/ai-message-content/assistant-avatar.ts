import { AiIcon } from '@blocksuite/icons/lit';
import { AIStarIconWithAnimation } from '@blocksuite/notesgraph/components/icons';
import { ShadowlessElement } from '@blocksuite/notesgraph/std';
import { css, html } from 'lit';
import { property } from 'lit/decorators.js';

import type { ChatStatus } from '../ai-chat-messages';

const NotesGraphAvatarIcon = AiIcon({
  width: '20px',
  height: '20px',
  style: 'color: var(--notesgraph-primary-color)',
});

export class AssistantAvatar extends ShadowlessElement {
  @property({ attribute: 'data-status', reflect: true })
  accessor status: ChatStatus = 'idle';

  static override styles = css`
    chat-assistant-avatar {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
  `;

  protected override render() {
    return html`${this.status === 'transmitting'
      ? AIStarIconWithAnimation
      : NotesGraphAvatarIcon}
    NotesGraph AI`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chat-assistant-avatar': AssistantAvatar;
  }
}
