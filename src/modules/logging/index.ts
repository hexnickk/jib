import { type ConsolaInstance, LogLevels, consola } from 'consola'

/** Returns whether `JIB_DEBUG` is enabled with a shell-style truthy value. */
function loggingIsDebugEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.JIB_DEBUG ?? '').toLowerCase())
}

/**
 * Returns a child logger prefixed with `[tag]`.
 * By default only warnings and errors are shown.
 */
export function loggingCreateLogger(tag: string): ConsolaInstance {
  const child = consola.withTag(tag)
  child.level = loggingIsDebugEnabled() ? LogLevels.debug : LogLevels.warn
  return child
}

export type Logger = ConsolaInstance
