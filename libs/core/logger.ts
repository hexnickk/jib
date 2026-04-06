import { LogLevels, type ConsolaInstance, consola } from 'consola'

const debug = !!process.env.JIB_DEBUG

/** Root logger used by the CLI entry point — always shows info+success. */
export const rootLogger: ConsolaInstance = consola

/**
 * Returns a child logger prefixed with `[tag]`. By default, tagged loggers
 * only show warnings and errors — the step-by-step detail (writing files,
 * systemctl calls, etc) is noise for normal users. Set `JIB_DEBUG=1` to
 * see everything.
 */
export function createLogger(tag: string): ConsolaInstance {
  const child = consola.withTag(tag)
  if (!debug) child.level = LogLevels.warn
  return child
}

export type Logger = ConsolaInstance
