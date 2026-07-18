import { readFile } from 'node:fs/promises'
import { InternalError, ValidationError } from '@jib/errors'
import { parse } from 'yaml'
import { ZodError } from 'zod'
import { type Config, ConfigSchema } from './schema.ts'
import { configValidate } from './validate.ts'

/** Reads `filePath`, parses YAML, runs zod + domain validation. */
export async function configLoad(
  filePath: string,
): Promise<Config | InternalError | ValidationError> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    return new InternalError(
      `reading config ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (error) {
    return new ValidationError(
      `parsing config ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  let cfg: Config
  try {
    cfg = ConfigSchema.parse(doc ?? {})
  } catch (error) {
    if (error instanceof ZodError) {
      const lines = error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      return new ValidationError(lines.join('\n'), { cause: error })
    }
    return new ValidationError(
      `validating config ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  return configValidate(cfg) ?? cfg
}
