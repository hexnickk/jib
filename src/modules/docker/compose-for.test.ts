import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { NotFoundError } from '@jib/errors'
import { type Paths, pathsGetPaths } from '@jib/paths'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dockerComposeFor } from './compose-for.ts'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(): { cfg: Config; paths: Paths } {
  const root = mkdtempSync(join(tmpdir(), 'jib-compose-for-'))
  tmpDirs.push(root)
  const paths = pathsGetPaths(root)
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
        domains: [],
      },
    },
  }
  return { cfg, paths }
}

describe('dockerComposeFor', () => {
  test('returns a typed error when the app is missing', () => {
    const { cfg, paths } = fixture()

    const result = dockerComposeFor(cfg, paths, 'ghost')

    expect(result).toBeInstanceOf(NotFoundError)
  })

  test('builds compose config from app config and an existing managed env file', () => {
    const { cfg, paths } = fixture()
    mkdirSync(join(paths.secretsDir, 'demo'), { recursive: true })
    writeFileSync(join(paths.secretsDir, 'demo', '.env'), 'KEY=value\n')

    const compose = dockerComposeFor(cfg, paths, 'demo')
    if (compose instanceof Error) {
      throw compose
    }

    expect(compose.cfg).toEqual({
      app: 'demo',
      dir: join(paths.reposDir, 'local', 'demo'),
      files: [join(paths.reposDir, 'local', 'demo', 'compose.yml')],
      override: join(paths.overridesDir, 'demo.yml'),
      envFile: join(paths.secretsDir, 'demo', '.env'),
    })
    expect(compose.projectName()).toBe('jib-demo')
  })

  test('uses a prepared workdir and injected exec without a managed env file', async () => {
    const { cfg, paths } = fixture()
    const workdir = join(paths.root, 'prepared', 'demo')
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    const compose = dockerComposeFor(cfg, paths, 'demo', { workdir, exec })
    if (compose instanceof Error) {
      throw compose
    }

    expect(compose.cfg).not.toHaveProperty('envFile')
    expect(await compose.up()).toBeUndefined()
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith(
      [
        'docker',
        'compose',
        '-p',
        'jib-demo',
        '-f',
        join(workdir, 'compose.yml'),
        'up',
        '-d',
        '--force-recreate',
        '--remove-orphans',
      ],
      { cwd: workdir },
    )
  })

  test.each([undefined, []])('defaults compose files when configured as %j', (composeFiles) => {
    const { cfg, paths } = fixture()
    cfg.apps.demo = {
      repo: 'local',
      branch: 'main',
      domains: [],
      ...(composeFiles ? { compose: composeFiles } : {}),
    }
    const compose = dockerComposeFor(cfg, paths, 'demo')
    if (compose instanceof Error) {
      throw compose
    }
    expect(compose.cfg.files).toEqual([join(paths.reposDir, 'local', 'demo', 'docker-compose.yml')])
  })

  test('resolves relative files and leaves absolute files unchanged', () => {
    const { cfg, paths } = fixture()
    const absoluteFile = join(paths.composeDir, 'demo.yml')
    cfg.apps.demo = {
      repo: 'owner/demo',
      branch: 'main',
      domains: [],
      compose: ['compose.yml', absoluteFile],
    }
    const compose = dockerComposeFor(cfg, paths, 'demo')
    if (compose instanceof Error) {
      throw compose
    }
    expect(compose.cfg.dir).toBe(join(paths.reposDir, 'github', 'owner', 'demo'))
    expect(compose.cfg.files).toEqual([
      join(paths.reposDir, 'github', 'owner', 'demo', 'compose.yml'),
      absoluteFile,
    ])
  })
})
