/**
 * The watcher polls configured repos and auto-deploys when a watched branch
 * moves. Repo preparation lives in the shared `@jib/sources` library.
 */
const manifest = {
  name: 'watcher',
  required: true,
  description: 'Git polling + autodeploy triggers',
} satisfies { name: string; required?: boolean; description?: string }

export default manifest
