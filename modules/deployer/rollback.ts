import { JibError } from '@jib/core'
import type { AppState } from '@jib/state'
import type { Engine } from './engine.ts'

export interface RollbackCmd {
  app: string
  user?: string
}

export interface RollbackResult {
  app: string
  previousSHA: string
  deployedSHA: string
  success: boolean
}

/**
 * Swaps deployed/previous in state and re-runs `compose up` against the
 * stored previous workdir. Deployer does not shell out to git — the
 * constraint from Stage 4 is that gitsitter is the sole git owner, so we
 * persist the last-known workdir alongside the sha and trust it still
 * exists on disk at rollback time.
 */
export async function rollback(engine: Engine, cmd: RollbackCmd): Promise<RollbackResult> {
  const state = await engine.deps.store.load(cmd.app)
  if (!state.previous_sha || !state.previous_workdir) {
    throw new JibError('rollback', `no previous deploy for app "${cmd.app}"`)
  }
  const appCfg = engine.deps.config.apps[cmd.app]
  if (!appCfg) throw new JibError('rollback', `app "${cmd.app}" not found in config`)

  const compose = engine.composeFor(cmd.app, appCfg, state.previous_workdir)
  await compose.up({ services: appCfg.services ?? [] })

  const next: AppState = {
    ...state,
    deployed_sha: state.previous_sha,
    deployed_workdir: state.previous_workdir,
    previous_sha: state.deployed_sha,
    previous_workdir: state.deployed_workdir,
    last_deploy: new Date().toISOString(),
    last_deploy_status: 'success',
    last_deploy_trigger: 'rollback',
    last_deploy_user: cmd.user ?? '',
    consecutive_failures: 0,
  }
  await engine.deps.store.save(cmd.app, next)

  return {
    app: cmd.app,
    previousSHA: state.deployed_sha,
    deployedSHA: state.previous_sha,
    success: true,
  }
}
