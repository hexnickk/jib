import { type ConsolaInstance, consola } from 'consola'

/** Root logger used by the CLI entry point and anywhere a tag isn't meaningful. */
export const rootLogger: ConsolaInstance = consola

/**
 * Returns a child logger that prefixes every message with `[tag]`. Tags are
 * how we keep log lines attributable once modules run concurrently.
 */
export function createLogger(tag: string): ConsolaInstance {
  return consola.withTag(tag)
}

export type Logger = ConsolaInstance
