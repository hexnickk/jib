export {
  DeployDiskCheckError,
  DeployDiskSpaceError,
  DeployHealthCheckError,
  DeployLockAcquireError,
  DeployLockReleaseError,
  DeployMissingAppError,
  DeployOverrideSyncError,
  DeploySecretsLinkError,
  DeployUnexpectedError,
} from './errors.ts'
export { MIN_DISK_BYTES } from './types.ts'
export { deployApp, deployDownApp, deployRestartApp, deployUpApp } from './service.ts'
export type { DeployCmd, DeployDeps, DeployError, DeployResult, ProgressCtx } from './types.ts'
