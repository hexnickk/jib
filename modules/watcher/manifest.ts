import type { ModuleManifest } from '@jib/core'

/**
 * The watcher polls configured repos and auto-deploys when a watched branch
 * moves. Repo preparation lives in the shared `@jib/sources` library.
 */
const manifest: ModuleManifest = {
  name: 'watcher',
  required: true,
  description: 'Git polling + autodeploy triggers',
}

export default manifest
