import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { ZodError } from 'zod'
import {
  ConfigError,
  ParseConfigError,
  ReadConfigError,
  ValidateConfigError,
  errorMessage,
} from './errors.ts'
import { type Config, ConfigSchema } from './schema.ts'
import { validateConfig } from './validate.ts'

/** Reads `filePath`, parses YAML, runs zod + domain validation. */
export async function loadConfigResult(filePath: string): Promise<Config | ConfigError> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    return new ReadConfigError(`reading config ${filePath}: ${errorMessage(error)}`, {
      cause: error,
    })
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (error) {
    return new ParseConfigError(`parsing config ${filePath}: ${errorMessage(error)}`, {
      cause: error,
    })
  }

  let cfg: Config
  try {
    cfg = ConfigSchema.parse(doc ?? {})
  } catch (error) {
    if (error instanceof ZodError) {
      const lines = error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      return new ValidateConfigError(lines.join('\n'), { cause: error })
    }
    return new ValidateConfigError(`validating config ${filePath}: ${errorMessage(error)}`, {
      cause: error,
    })
  }

  return validateConfig(cfg) ?? cfg
}

/** Reads `filePath`, parses YAML, runs zod + domain validation. */
export async function loadConfig(filePath: string): Promise<Config> {
  const loaded = await loadConfigResult(filePath)
  if (loaded instanceof ConfigError) throw loaded
  return loaded
}
