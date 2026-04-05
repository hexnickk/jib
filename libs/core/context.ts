import type { Logger } from './logger.ts'
import type { Paths } from './paths.ts'

/**
 * Runtime context handed to every module hook and start function. `bus` is
 * optional until Stage 2 (NATS) lands; `config` will be narrowed to the
 * `Config` type once `@jib/config` is a hard dependency across the graph.
 */
export interface ModuleContext {
  // biome-ignore lint/suspicious/noExplicitAny: config shape is defined in @jib/config, avoid cycle
  config: any
  logger: Logger
  paths: Paths
  bus?: unknown
}
