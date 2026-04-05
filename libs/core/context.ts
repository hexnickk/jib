import type { Logger } from './logger.ts'
import type { Paths } from './paths.ts'

/**
 * Runtime context handed to every module hook and start function. `bus` is
 * optional until Stage 2 (NATS) lands. `C` is the config shape — `@jib/core`
 * does not depend on `@jib/config` (that would cycle), so the actual `Config`
 * type is injected by the caller. `main.ts` constructs a
 * `ModuleContext<Config>` once `@jib/config` is imported.
 */
export interface ModuleContext<C = unknown> {
  config: C
  logger: Logger
  paths: Paths
  bus?: unknown
}
