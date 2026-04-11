export { collectSourceStatuses, runSourceSetup } from './recovery.ts'
export {
  buildSourceChoices,
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
  SourceSetupOption,
  SourceStatus,
  SourceTarget,
} from './types.ts'
export { cloneForInspection, probe, removeCheckout, resolve, syncApp } from './service.ts'
