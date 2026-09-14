// DOM-free entry: manifest schema + shared types. The client (`./client`) and
// server (`./server`) surfaces are exported from their own subpaths so the
// node sidecar can import the manifest without pulling React/DOM types.
export {
  type Capability,
  capabilitySchema,
  parseManifest,
  type Platform,
  platformSchema,
  type PluginManifest,
  pluginManifestSchema,
  safeParseManifest,
} from './manifest';
