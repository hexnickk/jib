export const manifest = {
  name: 'watcher',
  required: true,
  description: 'Git polling + autodeploy triggers',
} satisfies { name: string; required?: boolean; description?: string }

export { watcherInstallResult } from './install.ts'
export { watcherUninstallResult } from './uninstall.ts'
export {
  watcherParsePollInterval,
  watcherPollApp,
  watcherRunPollCycle,
  watcherRunPoller,
} from './poller.ts'
