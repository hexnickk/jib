export { collectSourceStatuses, runSourceSetup } from './recovery.ts'
export {
  buildSourceChoices,
  preflightSourceSelection,
  setupSourceRef,
} from './flow.ts'
export {
  SourceDriverNotRegisteredError,
  SourceLocalCheckoutError,
  SourceLocalRepoError,
  SourceMissingAppError,
  SourceMissingConfigError,
  SourceProbeError,
  SourceRemoteResolveError,
  SourceRemoteSyncError,
  SourceWorkdirPrepareError,
} from './errors.ts'
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
export {
  cloneForInspection,
  cloneSourceForInspection,
  probe,
  probeSource,
  removeCheckout,
  resolve,
  resolveSource,
  syncApp,
  syncSource,
} from './service.ts'
