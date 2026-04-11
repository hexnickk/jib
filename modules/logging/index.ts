import { type ConsolaInstance, LogLevels, consola } from 'consola'

/** True when the user wants verbose output. Check this before any expensive debug work. */
function isJibDebugEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.JIB_DEBUG ?? '').toLowerCase())
}

/**
 * Returns a child logger prefixed with `[tag]`. By default only shows
 * warnings and errors — step-by-step detail is hidden. Set `JIB_DEBUG=1`
 * to see everything.
 */
export function createLogger(tag: string): ConsolaInstance {
  const child = consola.withTag(tag)
  child.level = isJibDebugEnabled() ? LogLevels.debug : LogLevels.warn
  return child
}

export type Logger = ConsolaInstance
