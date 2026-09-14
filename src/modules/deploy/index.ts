export { deployCreateDeps } from './create-deps.ts'
export { MIN_DISK_BYTES } from './types.ts'
export {
  deployApp,
  deployStartApp,
  deployStopApp,
  deployRestartApp,
  deployRebuildApp,
} from './service.ts'
export type { DeployCmd, DeployDeps, DeployResult, DeployProgress } from './types.ts'
