import type { EditorHost } from '@blocksuite/notesgraph/std';
import { toReactNode } from '@notesgraph/component';
import { AIChatBlockPeekViewTemplate } from '@notesgraph/core/blocksuite/ai';
import type { AIChatBlockModel } from '@notesgraph/core/blocksuite/ai/blocks/ai-chat-block/model/ai-chat-model';
import { registerAIAppEffects } from '@notesgraph/core/blocksuite/ai/effects/app';
import { useAIChatConfig } from '@notesgraph/core/components/hooks/notesgraph/use-ai-chat-config';
import { useAISubscribe } from '@notesgraph/core/components/hooks/notesgraph/use-ai-subscribe';
import {
  AIDraftService,
  AIToolsConfigService,
} from '@notesgraph/core/modules/ai-button';
import { AIModelService } from '@notesgraph/core/modules/ai-button/services/models';
import {
  ServerService,
  SubscriptionService,
} from '@notesgraph/core/modules/cloud';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useFramework } from '@notesgraph/infra';
import { useMemo } from 'react';

registerAIAppEffects();

export type AIChatBlockPeekViewProps = {
  model: AIChatBlockModel;
  host: EditorHost;
};

export const AIChatBlockPeekView = ({
  model,
  host,
}: AIChatBlockPeekViewProps) => {
  const { docDisplayConfig, searchMenuConfig, reasoningConfig } =
    useAIChatConfig();

  const framework = useFramework();
  const serverService = framework.get(ServerService);
  const notesgraphFeatureFlagService = framework.get(FeatureFlagService);
  const notesgraphWorkspaceDialogService = framework.get(
    WorkspaceDialogService
  );
  const aiDraftService = framework.get(AIDraftService);
  const aiToolsConfigService = framework.get(AIToolsConfigService);
  const subscriptionService = framework.get(SubscriptionService);
  const aiModelService = framework.get(AIModelService);
  const handleAISubscribe = useAISubscribe();

  return useMemo(() => {
    const template = AIChatBlockPeekViewTemplate(
      model,
      host,
      docDisplayConfig,
      searchMenuConfig,
      reasoningConfig,
      serverService,
      notesgraphFeatureFlagService,
      notesgraphWorkspaceDialogService,
      aiDraftService,
      aiToolsConfigService,
      subscriptionService,
      aiModelService,
      handleAISubscribe
    );
    return toReactNode(template);
  }, [
    model,
    host,
    docDisplayConfig,
    searchMenuConfig,
    reasoningConfig,
    serverService,
    notesgraphFeatureFlagService,
    notesgraphWorkspaceDialogService,
    aiDraftService,
    aiToolsConfigService,
    subscriptionService,
    aiModelService,
    handleAISubscribe,
  ]);
};
