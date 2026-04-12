import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, ParseConfigError, ReadConfigError } from './errors.ts'
import { configLoad } from './load.ts'
import type { Config } from './schema.ts'
import { configWrite } from './write.ts'

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-cfg-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('configLoad/configWrite', () => {
  test('round-trips a full config', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'config.yml')
      const cfg: Config = {
        config_version: 3,
        poll_interval: '2m',
        modules: {},
        sources: {},
        apps: {
          web: {
            repo: 'hexnickk/web',
            branch: 'main',
            env_file: '.env',
            domains: [{ host: 'example.com', port: 8080 }],
          },
        },
      }
      expect(await configWrite(path, cfg)).toBeUndefined()
      const loaded = await configLoad(path)
      expect(loaded).not.toBeInstanceOf(ConfigError)
      if (loaded instanceof ConfigError) {
        throw loaded
      }
      expect(loaded.poll_interval).toBe('2m')
      expect(loaded.apps.web?.repo).toBe('hexnickk/web')
      expect(loaded.apps.web?.domains[0]?.host).toBe('example.com')
    })
  })

  test('configLoad returns ReadConfigError on missing file', async () => {
    const loaded = await configLoad('/no/such/file.yml')
    expect(loaded).toBeInstanceOf(ReadConfigError)
  })

  test('configLoad returns ParseConfigError on bad YAML', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'bad.yml')
      await Bun.write(path, 'foo: [bar')
      expect(await configLoad(path)).toBeInstanceOf(ParseConfigError)
    })
  })
})
