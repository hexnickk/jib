import {
  type DeployCmd,
  type DeployResult,
  type EngineDeps,
  type ProgressCtx,
  deployApp,
  downApp,
  restartApp,
  upApp,
} from './service.ts'

/**
 * Compatibility wrapper for callers that still expect the historical
 * class-based API. The module's primary implementation lives in plain
 * functions in `service.ts`.
 */
export class Engine {
  constructor(readonly deps: EngineDeps) {}

  async deploy(cmd: DeployCmd, progress: ProgressCtx): Promise<DeployResult> {
    const result = await deployApp(this.deps, cmd, progress)
    if (result instanceof Error) throw result
    return result
  }

  async up(appName: string): Promise<void> {
    const result = await upApp(this.deps, appName)
    if (result instanceof Error) throw result
  }

  async down(appName: string, removeVolumes = false): Promise<void> {
    const result = await downApp(this.deps, appName, removeVolumes)
    if (result instanceof Error) throw result
  }

  async restart(appName: string): Promise<void> {
    const result = await restartApp(this.deps, appName)
    if (result instanceof Error) throw result
  }
}
