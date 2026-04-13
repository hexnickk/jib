import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { ZodError } from 'zod'
import {
  type ConfigError,
  ParseConfigError,
  ReadConfigError,
  ValidateConfigError,
  configErrorMessage,
} from './errors.ts'
import { type Config, ConfigSchema } from './schema.ts'
import { configValidate } from './validate.ts'

/** Reads `filePath`, parses YAML, runs zod + domain validation. */
export async function configLoad(filePath: string): Promise<Config | ConfigError> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    return new ReadConfigError(`reading config ${filePath}: ${configErrorMessage(error)}`, {
      cause: error,
    })
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (error) {
    return new ParseConfigError(`parsing config ${filePath}: ${configErrorMessage(error)}`, {
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
    return new ValidateConfigError(`validating config ${filePath}: ${configErrorMessage(error)}`, {
      cause: error,
    })
  }

  return configValidate(cfg) ?? cfg
}
