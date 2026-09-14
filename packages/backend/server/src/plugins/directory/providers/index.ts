import { GoogleDirectoryProvider } from './google';

export type {
  DirectoryAccountProfile,
  DirectoryProviderGroup,
  DirectoryProviderListGroupMembersParams,
  DirectoryProviderListGroupsParams,
  DirectoryProviderListOrgUnitsParams,
  DirectoryProviderListUsersParams,
  DirectoryProviderOrgUnit,
  DirectoryProviderTokens,
  DirectoryProviderUser,
} from './def';
export { DirectoryProvider } from './def';
export { DirectoryProviderFactory, DirectoryProviderName } from './factory';
export { GoogleDirectoryProvider } from './google';

export const DirectoryProviders = [GoogleDirectoryProvider];
