import { SurfaceBlockSchema } from '@blocksuite/notesgraph/blocks/surface';
import { BlockService } from '@blocksuite/notesgraph/std';

export class MindmapSurfaceBlockService extends BlockService {
  static override readonly flavour = SurfaceBlockSchema.model.flavour;
}
