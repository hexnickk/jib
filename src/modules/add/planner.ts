import { type AddInspectComposeDeps, addInspectCompose } from './inspect.ts'
import { addConfirmPlan } from './plan.ts'
import { addBuildResolvedApp, addCollectGuidedInputs } from './resolve.ts'
import type { AddPlanner } from './types.ts'

export interface AddPlannerDeps extends AddInspectComposeDeps {
  canScaffoldCompose?: (workdir: string) => boolean
  isInteractive?: () => boolean
  note?: typeof import('@jib/tui').note
  promptConfirm?: typeof import('@jib/tui').promptConfirm
  promptString?: typeof import('@jib/tui').promptString
  scaffoldComposeFromDockerfile?: (workdir: string) => string | null
}

/** Creates the planner used by the add flow to inspect, enrich, and confirm apps. */
export function addCreatePlanner(deps: AddPlannerDeps = {}): AddPlanner {
  return {
    inspectCompose: (draftApp, workdir) => addInspectCompose(draftApp, workdir, deps),
    collectGuidedInputs: addCollectGuidedInputs,
    buildResolvedApp: addBuildResolvedApp,
    confirmPlan: addConfirmPlan,
  }
}
