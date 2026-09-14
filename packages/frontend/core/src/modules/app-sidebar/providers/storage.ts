import { createIdentifier, type Memento } from '@notesgraph/infra';

export interface AppSidebarState extends Memento {}

export const AppSidebarState =
  createIdentifier<AppSidebarState>('AppSidebarState');
