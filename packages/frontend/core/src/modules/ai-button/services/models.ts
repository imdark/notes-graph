import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/notesgraph/shared/utils';
import { getPromptModelsQuery, SubscriptionStatus } from '@notesgraph/graphql';
import { LiveData, Service } from '@notesgraph/infra';
import { signal } from '@preact/signals-core';

import {
  type AiBackend,
  type AiBackendService,
  DEFAULT_LOCAL_MODEL,
} from '../../ai-local';
import type { GraphQLService, SubscriptionService } from '../../cloud';
import type { GlobalStateService } from '../../storage';

const AI_MODEL_ID_KEY = 'AIModelId';

export interface AIModel {
  name: string;
  id: string;
  version: string;
  category: string;
  isPro: boolean;
  isDefault: boolean;
}

/** Models offered when the on-device backend is selected. */
export const LOCAL_MODELS: AIModel[] = [
  {
    name: 'Llama 3.2 1B',
    id: DEFAULT_LOCAL_MODEL,
    version: 'On-device',
    category: 'Local',
    isPro: false,
    isDefault: true,
  },
];

export class AIModelService extends Service {
  modelId: Signal<string | undefined>;

  models: Signal<AIModel[]> = signal([]);

  private readonly modelId$ = LiveData.from(
    this.globalStateService.globalState.watch<string>(AI_MODEL_ID_KEY),
    undefined
  );

  constructor(
    private readonly globalStateService: GlobalStateService,
    private readonly gqlService: GraphQLService,
    private readonly subscriptionService: SubscriptionService,
    private readonly aiBackendService: AiBackendService
  ) {
    super();

    const { signal: modelId, cleanup } = createSignalFromObservable<
      string | undefined
    >(this.modelId$, undefined);
    this.modelId = modelId;
    this.disposables.push(cleanup);

    // Reload the model list whenever the backend (cloud vs on-device) changes.
    const backendSub = this.aiBackendService.backend$.subscribe(backend => {
      this.loadModels(backend).catch(err => {
        console.error(err);
      });
    });
    this.disposables.push(() => backendSub.unsubscribe());

    // Reset a Pro model if the AI subscription lapses (cloud only).
    const sub = this.subscriptionService.subscription.ai$.subscribe(
      subscription => {
        const isSubscribed = subscription?.status === SubscriptionStatus.Active;
        const model = this.models.value.find(
          model => model.id === this.modelId.value
        );
        if (!isSubscribed && model?.isPro) {
          this.resetModel();
        }
      }
    );
    this.disposables.push(() => sub.unsubscribe());
  }

  resetModel = () => {
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, undefined);
  };

  setModel = (modelId: string) => {
    const isSubscribed =
      this.subscriptionService.subscription.ai$.value?.status ===
      SubscriptionStatus.Active;
    const model = this.models.value.find(model => model.id === modelId);
    if (!isSubscribed && model?.isPro) {
      return;
    }
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, modelId);
  };

  private readonly loadModels = async (backend: AiBackend) => {
    if (backend === 'local') {
      this.models.value = LOCAL_MODELS;
      return;
    }
    await this.initModels();
  };

  private readonly initModels = async (prompt?: string) => {
    const promptName = prompt || 'Chat With NotesGraph AI';
    const models = await this.getModelsByPrompt(promptName);
    if (models) {
      const { defaultModel, optionalModels, proModels } = models;
      this.models.value = optionalModels.map(model => {
        const [category] = model.name.split(' ');
        const version = model.name.slice(category.length + 1);
        return {
          name: model.name,
          id: model.id,
          version,
          category,
          isPro: proModels.some(proModel => proModel.id === model.id),
          isDefault: model.id === defaultModel,
        };
      });
    }
  };

  private readonly getModelsByPrompt = async (promptName: string) => {
    return this.gqlService
      .gql({
        query: getPromptModelsQuery,
        variables: { promptName },
      })
      .then(res => res.currentUser?.copilot?.models);
  };
}
