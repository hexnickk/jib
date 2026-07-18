import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InternalError, ValidationError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
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
            domains: [{ host: 'example.com', port: 8080 }],
          },
        },
      }
      expect(await configWrite(path, cfg)).toBeUndefined()
      const loaded = await configLoad(path)
      expect(loaded).not.toBeInstanceOf(Error)
      if (loaded instanceof Error) {
        throw loaded
      }
      expect(loaded.poll_interval).toBe('2m')
      expect(loaded.apps.web?.repo).toBe('hexnickk/web')
      expect(loaded.apps.web?.domains[0]?.host).toBe('example.com')
    })
  })

  test('configWrite rejects a complete config that violates domain invariants', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'config.yml')
      const result = await configWrite(path, {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {
          web: {
            repo: 'owner/web',
            branch: 'main',
            domains: [{ host: 'web.example.com', port: 20000, ingress: 'cloudflare-tunnel' }],
          },
        },
      })

      expect(result).toBeInstanceOf(ValidationError)
    })
  })

  test('configLoad returns an internal error on missing file', async () => {
    const loaded = await configLoad('/no/such/file.yml')
    expect(loaded).toBeInstanceOf(InternalError)
  })

  test('configLoad returns a validation error on bad YAML', async () => {
    await withTmp(async (dir) => {
      const path = join(dir, 'bad.yml')
      await writeFile(path, 'foo: [bar')
      expect(await configLoad(path)).toBeInstanceOf(ValidationError)
    })
  })
})
