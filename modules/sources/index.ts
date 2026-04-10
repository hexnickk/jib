export {
  availableSourceSetupChoices,
  collectSourceStatuses,
  configuredSourceOptions,
  isSourceAuthFailure,
  repoSupportsSourceRecovery,
  runSourceSetup,
} from './recovery.ts'
export {
  buildSourceChoices,
  maybeRecoverSource,
  preflightSourceSelection,
  setupSourceRef,
} from './flow.ts'
export type {
  DriverSourceStatus,
  InspectionCheckout,
  PreparedSource,
  ProbeSourceDeps,
  ResolvedSource,
  SourceDriver,
  SourceProbe,
  SourceSelectOption,
  SourceSetupChoice,
  SourceStatus,
  SourceTarget,
} from './types.ts'
export { cloneForInspection, probe, removeCheckout, resolve, syncApp } from './service.ts'
