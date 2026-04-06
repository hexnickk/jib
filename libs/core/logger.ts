import { type ConsolaInstance, LogLevels, consola } from 'consola'

/** True when the user wants verbose output. Check this before any expensive debug work. */
export const JIB_DEBUG = !!process.env.JIB_DEBUG

/** Root logger — always shows info+success for user-facing milestones. */
export const rootLogger: ConsolaInstance = consola

/**
 * Returns a child logger prefixed with `[tag]`. By default only shows
 * warnings and errors — step-by-step detail (writing files, systemctl
 * calls, nats connect) is hidden. Set `JIB_DEBUG=1` to see everything.
 */
export function createLogger(tag: string): ConsolaInstance {
  const child = consola.withTag(tag)
  if (!JIB_DEBUG) child.level = LogLevels.warn
  return child
}

export type Logger = ConsolaInstance
