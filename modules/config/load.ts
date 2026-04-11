import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { ZodError } from 'zod'
import { ConfigError } from './errors.ts'
import { type Config, ConfigSchema } from './schema.ts'
import { validate } from './validate.ts'

/** Reads `filePath`, parses YAML, runs zod + domain validation. */
export async function loadConfig(filePath: string): Promise<Config> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new ConfigError(`reading config ${filePath}: ${(err as Error).message}`, { cause: err })
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (err) {
    throw new ConfigError(`parsing config ${filePath}: ${(err as Error).message}`, { cause: err })
  }

  let cfg: Config
  try {
    cfg = ConfigSchema.parse(doc ?? {})
  } catch (err) {
    if (err instanceof ZodError) {
      const lines = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      throw new ConfigError(lines.join('\n'), { cause: err })
    }
    throw err
  }

  validate(cfg)
  return cfg
}
