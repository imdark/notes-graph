import { EdgelessClipboardConfig } from '@blocksuite/notesgraph-block-surface';
import { type BlockSnapshot } from '@blocksuite/store';

export class EdgelessClipboardEmbedGithubConfig extends EdgelessClipboardConfig {
  static override readonly key = 'notesgraph:embed-github';

  override createBlock(githubEmbed: BlockSnapshot): string | null {
    if (!this.surface) return null;

    const {
      xywh,
      style,
      owner,
      repo,
      githubType,
      githubId,
      url,
      caption,
      image,
      status,
      statusReason,
      title,
      description,
      createdAt,
      assignees,
    } = githubEmbed.props;

    const embedGithubId = this.crud.addBlock(
      'notesgraph:embed-github',
      {
        xywh,
        style,
        owner,
        repo,
        githubType,
        githubId,
        url,
        caption,
        image,
        status,
        statusReason,
        title,
        description,
        createdAt,
        assignees,
      },
      this.surface.model.id
    );
    return embedGithubId;
  }
}
