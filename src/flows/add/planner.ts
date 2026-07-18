import { type AddInspectComposeDeps, addInspectCompose } from './inspect.ts'
import { addConfirmPlan } from './plan.ts'
import { addBuildResolvedApp, addCollectGuidedInputs } from './resolve.ts'
import type { AddPlanner } from './types.ts'

export type AddPlannerDeps = AddInspectComposeDeps

/** Creates the planner used by the add flow to inspect, enrich, and confirm apps. */
export function addCreatePlanner(deps: AddPlannerDeps = {}): AddPlanner {
  return {
    inspectCompose: (draftApp, workdir) => addInspectCompose(draftApp, workdir, deps),
    collectGuidedInputs: addCollectGuidedInputs,
    buildResolvedApp: addBuildResolvedApp,
    confirmPlan: addConfirmPlan,
  }
}
