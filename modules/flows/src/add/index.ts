export { normalizeAddError } from './errors.ts'
export {
  assignCliDomainsToServices,
  buildAdditionalSecretPromptMessage,
  buildManualSecretPromptLines,
  buildSecretPromptMessage,
  mergeGuidedServiceAnswers,
  parseEnvEntry,
  renderAddPlanSummary,
  secretPromptPlaceholder,
  shouldDefaultExposeService,
  splitCommaValues,
  summarizeComposeServices,
  validateEnvEntry,
} from './guided.ts'
export { buildDraftApp, gatherAddInputs, parseApp } from './inputs.ts'
export { createAddPlanner } from './planner.ts'
export { AddService } from './service.ts'
export { RolledBackAddError, runAddSequence } from './sequence.ts'
export { DefaultAddSupport, type DefaultAddSupportOptions } from './support.ts'
export type {
  AddFlowObserver,
  AddFlowParams,
  AddFlowResult,
  AddFlowState,
  AddInputs,
  AddPlanner,
  AddSupport,
  EnvEntry,
  GuidedInputs,
} from './types.ts'
