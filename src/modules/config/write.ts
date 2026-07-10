import { chmod, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import {
  SerializeConfigError,
  type ValidateConfigError,
  WriteConfigError,
  configErrorMessage,
} from './errors.ts'
import type { Config } from './schema.ts'
import { configValidate } from './validate.ts'

/** Validates `config`, serializes it to YAML, and writes it atomically by temp-file rename. */
export async function configWrite(
  filePath: string,
  config: Config,
): Promise<undefined | ValidateConfigError | SerializeConfigError | WriteConfigError> {
  const validationError = configValidate(config)
  if (validationError) return validationError

  let yaml: string
  try {
    yaml = stringify(config)
  } catch (error) {
    return new SerializeConfigError(`marshaling config: ${configErrorMessage(error)}`, {
      cause: error,
    })
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
    return new WriteConfigError(`writing config ${filePath}: ${configErrorMessage(error)}`, {
      cause: error,
    })
  }
}
