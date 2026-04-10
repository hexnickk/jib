import type { AddFlowObserver, AddFlowParams, AddSupport, CleanupState } from './types.ts'

export async function cleanupFailedAdd(
  params: AddFlowParams,
  support: AddSupport,
  observer: AddFlowObserver,
  state: CleanupState,
): Promise<void> {
  if (state.preparedRepo) {
    try {
      await support.removeCheckout(params.appName, params.inputs.repo)
    } catch (error) {
      observer.warn?.(`repo rollback: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const key of state.writtenSecretKeys) {
    try {
      await support.removeSecret(params.appName, key, state.finalEnvFile)
    } catch (error) {
      observer.warn?.(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!state.configWritten) return

  try {
    const current = await support.loadConfig(params.configFile).catch((error) => {
      observer.warn?.(
        `config cleanup load: ${error instanceof Error ? error.message : String(error)}; falling back to original snapshot`,
      )
      return params.cfg
    })
    const rollbackApps = { ...current.apps }
    delete rollbackApps[params.appName]
    await support.writeConfig(params.configFile, { ...current, apps: rollbackApps })
  } catch (error) {
    observer.warn?.(`config cleanup: ${error instanceof Error ? error.message : String(error)}`)
  }
}
