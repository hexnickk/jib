import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './load.ts'
import type { Config } from './schema.ts'
import { writeConfig } from './write.ts'

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-cfg-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('loadConfig/writeConfig', () => {
  test('round-trips a full config', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'config.yml')
      const cfg: Config = {
        config_version: 3,
        poll_interval: '2m',
        modules: {},
        apps: {
          web: {
            repo: 'hexnickk/web',
            branch: 'main',
            env_file: '.env',
            domains: [{ host: 'example.com', port: 8080 }],
          },
        },
      }
      await writeConfig(path, cfg)
      const loaded = await loadConfig(path)
      expect(loaded.poll_interval).toBe('2m')
      expect(loaded.apps.web?.repo).toBe('hexnickk/web')
      expect(loaded.apps.web?.domains[0]?.host).toBe('example.com')
    })
  })

  test('throws ConfigError on missing file', async () => {
    await expect(loadConfig('/no/such/file.yml')).rejects.toThrow(/reading config/)
  })

  test('throws ConfigError on bad YAML', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'bad.yml')
      await Bun.write(path, ':::::\n  not yaml')
      await expect(loadConfig(path)).rejects.toThrow()
    })
  })
})
