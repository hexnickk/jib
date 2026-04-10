import type { ModuleManifest } from '@jib/core'

/**
 * gitsitter polls configured repos and emits `cmd.deploy` when a watched
 * branch moves. Repo preparation now lives in the shared `@jib/sources`
 * library and is called directly by the CLI.
 */
const manifest: ModuleManifest = {
  name: 'gitsitter',
  required: true,
  description: 'Git polling + autodeploy triggers',
}

export default manifest
