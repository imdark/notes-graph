import { PackageList, type PackageName } from './yarn';

export const PackageToDistribution = new Map<
  PackageName,
  BUILD_CONFIG_TYPE['distribution']
>([
  ['@notesgraph/admin', 'admin'],
  ['@notesgraph/web', 'web'],
  ['@notesgraph/media-capture-playground', 'web'],
  ['@notesgraph/electron-renderer', 'desktop'],
  ['@notesgraph/electron', 'desktop'],
  ['@notesgraph/mobile', 'mobile'],
  ['@notesgraph/ios', 'ios'],
  ['@notesgraph/android', 'android'],
]);

export const AliasToPackage = new Map<string, PackageName>([
  ['admin', '@notesgraph/admin'],
  ['web', '@notesgraph/web'],
  ['electron', '@notesgraph/electron'],
  ['desktop', '@notesgraph/electron-renderer'],
  ['renderer', '@notesgraph/electron-renderer'],
  ['mobile', '@notesgraph/mobile'],
  ['ios', '@notesgraph/ios'],
  ['android', '@notesgraph/android'],
  ['server', '@notesgraph/server'],
  ['gql', '@notesgraph/graphql'],
  ...PackageList.map(
    pkg => [pkg.name.split('/').pop()!, pkg.name] as [string, PackageName]
  ),
]);
