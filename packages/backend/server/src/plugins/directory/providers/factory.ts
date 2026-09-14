import { Injectable, Logger } from '@nestjs/common';

export enum DirectoryProviderName {
  Google = 'google',
}

export interface DirectoryProviderRef {
  provider: DirectoryProviderName;
}

@Injectable()
export class DirectoryProviderFactory<
  TProvider extends DirectoryProviderRef = DirectoryProviderRef,
> {
  private readonly logger = new Logger(DirectoryProviderFactory.name);
  readonly #providers = new Map<DirectoryProviderName, TProvider>();

  get providers() {
    return Array.from(this.#providers.keys());
  }

  get(name: DirectoryProviderName) {
    return this.#providers.get(name);
  }

  register(provider: TProvider) {
    this.#providers.set(provider.provider, provider);
    this.logger.log(`Directory provider [${provider.provider}] registered.`);
  }

  unregister(provider: TProvider) {
    this.#providers.delete(provider.provider);
    this.logger.log(`Directory provider [${provider.provider}] unregistered.`);
  }
}
