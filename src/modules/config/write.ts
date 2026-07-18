import { chmod, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { InternalError, type ValidationError } from '@jib/errors'
import { stringify } from 'yaml'
import type { Config } from './schema.ts'
import { configValidate } from './validate.ts'

/** Validates `config`, serializes it to YAML, and writes it atomically by temp-file rename. */
export async function configWrite(
  filePath: string,
  config: Config,
): Promise<undefined | ValidationError | InternalError> {
  const validationError = configValidate(config)
  if (validationError) {
    return validationError
  }

  let yaml: string
  try {
    yaml = stringify(config)
  } catch (error) {
    return new InternalError(
      `marshaling config: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const dir = dirname(filePath)
  const tmp = join(dir, `.jib-config-${process.pid}-${Date.now()}.yml`)
  try {
    await writeFile(tmp, yaml, { mode: 0o640 })
    try {
      const info = await stat(filePath)
      await chmod(tmp, info.mode & 0o777)
    } catch {
      // original does not exist yet; keep 0640
    }
    await rename(tmp, filePath)
    return undefined
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    return new InternalError(
      `writing config ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
