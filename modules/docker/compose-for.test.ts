import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { composeForResult } from './compose-for.ts'
import { DockerAppNotFoundError } from './errors.ts'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(): { cfg: Config; paths: Paths } {
  const root = mkdtempSync(join(tmpdir(), 'jib-compose-for-'))
  tmpDirs.push(root)
  const paths: Paths = {
    root,
    configFile: join(root, 'config.yml'),
    stateDir: join(root, 'state'),
    locksDir: join(root, 'locks'),
    secretsDir: join(root, 'secrets'),
    overridesDir: join(root, 'overrides'),
    composeDir: join(root, 'compose'),
    reposDir: join(root, 'repos'),
    repoRoot: join(root, 'src'),
    nginxDir: join(root, 'nginx'),
    cloudflaredDir: join(root, 'cloudflared'),
  }
  const cfg: Config = {
    config_version: 3,
    poll_interval: '5m',
    modules: {},
    sources: {},
    apps: {
      demo: {
        repo: 'local',
        branch: 'main',
        compose: ['compose.yml'],
        env_file: '.env',
        domains: [],
      },
    },
  }
  return { cfg, paths }
}

describe('composeForResult', () => {
  test('returns a typed error when the app is missing', () => {
    const { cfg, paths } = fixture()

    const result = composeForResult(cfg, paths, 'ghost')

    expect(result).toBeInstanceOf(DockerAppNotFoundError)
  })

  test('builds compose config from app config and existing env file', () => {
    const { cfg, paths } = fixture()
    mkdirSync(join(paths.reposDir, 'local', 'demo'), { recursive: true })
    mkdirSync(join(paths.secretsDir, 'demo'), { recursive: true })
    writeFileSync(join(paths.secretsDir, 'demo', '.env'), 'KEY=value\n')

    const result = composeForResult(cfg, paths, 'demo')

    expect(result).not.toBeInstanceOf(DockerAppNotFoundError)
    if (result instanceof DockerAppNotFoundError) return
    expect(result.cfg.files).toEqual([join(paths.reposDir, 'local', 'demo', 'compose.yml')])
    expect(result.cfg.envFile).toBe(join(paths.secretsDir, 'demo', '.env'))
    expect(result.cfg.override).toBe(join(paths.overridesDir, 'demo.yml'))
  })
})
