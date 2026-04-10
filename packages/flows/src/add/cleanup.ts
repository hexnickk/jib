import type { AddFlowParams, AddFlowServices, CleanupState } from './types.ts'

export async function cleanupFailedAdd(
  params: AddFlowParams,
  services: AddFlowServices,
  state: CleanupState,
): Promise<void> {
  if (state.preparedRepo) {
    try {
      await services.repo.rollback(params.appName, params.inputs.repo)
    } catch (error) {
      services.warn?.(`repo rollback: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const key of state.writtenSecretKeys) {
    try {
      await services.secrets.remove(params.appName, key, state.finalEnvFile)
    } catch (error) {
      services.warn?.(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (!state.configWritten) return

  try {
    const current = await services.config.load(params.configFile).catch((error) => {
      services.warn?.(
        `config cleanup load: ${error instanceof Error ? error.message : String(error)}; falling back to original snapshot`,
      )
      return params.cfg
    })
    const rollbackApps = { ...current.apps }
    delete rollbackApps[params.appName]
    await services.config.write(params.configFile, { ...current, apps: rollbackApps })
  } catch (error) {
    services.warn?.(`config cleanup: ${error instanceof Error ? error.message : String(error)}`)
  }
}
