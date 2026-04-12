import { chmod, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { ConfigError, SerializeConfigError, WriteConfigError, errorMessage } from './errors.ts'
import type { Config } from './schema.ts'

/** Serializes `config` to YAML and writes it atomically (temp file + rename). */
export async function writeConfigResult(
  filePath: string,
  config: Config,
): Promise<undefined | ConfigError> {
  let yaml: string
  try {
    yaml = stringify(config)
  } catch (error) {
    return new SerializeConfigError(`marshaling config: ${errorMessage(error)}`, {
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
      // original doesn't exist; keep 0640
    }
    await rename(tmp, filePath)
    return
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    return new WriteConfigError(`writing config ${filePath}: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

/** Serializes `config` to YAML and writes it atomically (temp file + rename). */
export async function writeConfig(filePath: string, config: Config): Promise<void> {
  const result = await writeConfigResult(filePath, config)
  if (result instanceof ConfigError) throw result
}
