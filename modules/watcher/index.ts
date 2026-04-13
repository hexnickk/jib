export const manifest = {
  name: 'watcher',
  required: true,
  description: 'Git polling + autodeploy triggers',
} satisfies { name: string; required?: boolean; description?: string }

export {
  WatcherDeployAppError,
  WatcherInstallEnableError,
  WatcherInstallReloadError,
  WatcherInstallWriteUnitError,
  WatcherProbeAppError,
  WatcherSyncAppError,
  WatcherUninstallRemoveUnitError,
} from './errors.ts'
export {
  watcherInstallResult,
  watcherInstall,
  watcherInstall as install,
  watcherInstallResult as installWatcher,
} from './install.ts'
export {
  watcherUninstallResult,
  watcherUninstall,
  watcherUninstall as uninstall,
  watcherUninstallResult as uninstallWatcher,
} from './uninstall.ts'
export {
  watcherParsePollInterval,
  watcherParsePollInterval as parsePollInterval,
  watcherPollApp,
  watcherPollApp as pollApp,
  watcherRunPollCycle,
  watcherRunPollCycle as runPollCycle,
  watcherRunPoller,
  watcherRunPoller as runPoller,
} from './poller.ts'
