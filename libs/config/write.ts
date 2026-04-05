import { chmod, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ConfigError } from '@jib/core'
import { stringify } from 'yaml'
import type { Config } from './schema.ts'

/** Serializes `config` to YAML and writes it atomically (temp file + rename). */
export async function writeConfig(filePath: string, config: Config): Promise<void> {
  let yaml: string
  try {
    yaml = stringify(config)
  } catch (err) {
    throw new ConfigError(`marshaling config: ${(err as Error).message}`, { cause: err })
  }

  const dir = dirname(filePath)
  const tmp = join(dir, `.jib-config-${process.pid}-${Date.now()}.yml`)
  try {
    await writeFile(tmp, yaml, { mode: 0o600 })
    // Preserve the mode of any existing file; best-effort.
    try {
      const info = await stat(filePath)
      await chmod(tmp, info.mode & 0o777)
    } catch {
      // original doesn't exist; keep 0600
    }
    await rename(tmp, filePath)
  } catch (err) {
    throw new ConfigError(`writing config ${filePath}: ${(err as Error).message}`, { cause: err })
  }
}
