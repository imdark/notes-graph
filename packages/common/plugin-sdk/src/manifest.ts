import { z } from 'zod';

/** Capabilities a plugin can request; the host only exposes granted ones. */
export const capabilitySchema = z.enum([
  'docs',
  'ui',
  'editor',
  'docModes',
  'hooks',
  'commands',
  'storage',
  'backend',
  'net',
  'native',
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const platformSchema = z.enum(['web', 'desktop', 'mobile']);
export type Platform = z.infer<typeof platformSchema>;

/**
 * The `manifest.json` shipped in every plugin bundle. Validated by the host on
 * load and by the marketplace on publish.
 */
export const pluginManifestSchema = z
  .object({
    // reverse-DNS id, e.g. `com.acme.todo`
    id: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
        'id must be reverse-DNS, e.g. com.acme.todo'
      ),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+/, 'version must be semver'),
    description: z.string().optional(),
    author: z.string().optional(),
    homepage: z.string().url().optional(),
    icon: z.string().optional(),
    platforms: z
      .array(platformSchema)
      .nonempty()
      .default(['web', 'desktop', 'mobile']),
    permissions: z.array(capabilitySchema).default([]),
    minAppVersion: z.string().optional(),
    entry: z
      .object({
        client: z.string().optional(),
        server: z.string().optional(),
      })
      .default({}),
    contributes: z
      .object({
        commands: z
          .array(z.object({ id: z.string(), title: z.string() }))
          .optional(),
        settings: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parseManifest(input: unknown): PluginManifest {
  return pluginManifestSchema.parse(input);
}

export function safeParseManifest(input: unknown) {
  return pluginManifestSchema.safeParse(input);
}
