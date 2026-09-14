import type {
  CredentialsRequirementType,
  OAuthProviderType,
  ServerDeploymentType,
  ServerFeature,
} from '@notesgraph/graphql';

export interface ServerMetadata {
  id: string;

  baseUrl: string;
}

export interface ServerConfig {
  serverName: string;
  features: ServerFeature[];
  oauthProviders: OAuthProviderType[];
  type: ServerDeploymentType;
  initialized?: boolean;
  version?: string;
  credentialsRequirement: CredentialsRequirementType;
  /** Uppy Companion server url for remote-source uploads; null/undefined when not configured. */
  companionUrl?: string | null;
}
