import type { Logger } from './logger.ts'
import type { Paths } from './paths.ts'

/**
 * Runtime context handed to every module hook. `C` is the config shape —
 * `@jib/core` does not depend on `@jib/config` (that would cycle), so the
 * actual `Config` type is injected by the caller.
 */
export interface ModuleContext<C = unknown> {
  config: C
  logger: Logger
  paths: Paths
}
