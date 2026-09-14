import {
  EdgelessTemplatePanel,
  type TemplateManager,
} from '@blocksuite/notesgraph/gfx/template';
import { builtInTemplates as builtInEdgelessTemplates } from '@notesgraph/templates/edgeless';
import { builtInTemplates as builtInStickersTemplates } from '@notesgraph/templates/stickers';

export function registerTemplates() {
  EdgelessTemplatePanel.templates.extend(
    builtInStickersTemplates as TemplateManager
  );
  EdgelessTemplatePanel.templates.extend(
    builtInEdgelessTemplates as TemplateManager
  );
}
