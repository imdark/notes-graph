import type { app, dialog, shell } from 'electron';

export interface ExposedMeta {
  handlers: [string, string[]][];
  events: [string, string[]][];
}

// render <-> helper
export interface RendererToHelper {
  postEvent: (channel: string, ...args: any[]) => void;
}

export interface HelperToRenderer {
  [key: string]: (...args: any[]) => Promise<any>;
}

// helper <-> main
export interface HelperToMain {
  getMeta: () => ExposedMeta;
}

export type MainToHelper = Pick<
  typeof dialog & typeof shell & typeof app,
  | 'showOpenDialog'
  | 'showSaveDialog'
  | 'openExternal'
  | 'showItemInFolder'
  | 'getPath'
>;

export const NOTESGRAPH_API_CHANNEL_NAME = 'notesgraph-ipc-api';
export const NOTESGRAPH_EVENT_CHANNEL_NAME = 'notesgraph-ipc-event';
export const NOTESGRAPH_EVENT_SUBSCRIBE_CHANNEL_NAME =
  'notesgraph-ipc-event-subscribe';
