import type { Engine } from './engine.ts'

export interface ResumeCmd {
  app: string
}

/**
 * Clears the "paused" state flags on an app: consecutive_failures → 0 and
 * pinned → false, so the next poll can re-trigger autodeploy. Pure state op,
 * no docker calls, so it's safe to run on an unhealthy host.
 */
export async function resume(engine: Engine, cmd: ResumeCmd): Promise<void> {
  const state = await engine.deps.store.load(cmd.app)
  state.consecutive_failures = 0
  state.pinned = false
  await engine.deps.store.save(cmd.app, state)
}
