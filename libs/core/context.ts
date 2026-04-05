import type { ConsolaInstance } from 'consola'

/**
 * Runtime context handed to every module hook and start function.
 * `bus` is optional until Stage 2 (NATS) lands.
 */
export interface ModuleContext {
  config: unknown
  logger: ConsolaInstance
  paths: {
    root: string
    state: string
    secrets: string
  }
  bus?: unknown
}
