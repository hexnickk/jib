import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { setCliRuntime } from '@jib/core'
import type { Paths } from '@jib/core'
import { runDeploy } from './deploy-run.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [], env_file: '.env' },
  },
}

const paths: Paths = {
  root: '/opt/jib',
  repoRoot: '/opt/jib/src',
  configFile: '/opt/jib/config.yml',
  cloudflaredDir: '/opt/jib/cloudflared',
  locksDir: '/opt/jib/locks',
  nginxDir: '/opt/jib/nginx',
  overridesDir: '/opt/jib/overrides',
  reposDir: '/opt/jib/repos',
  secretsDir: '/opt/jib/secrets',
  stateDir: '/opt/jib/state',
}

describe('runDeploy', () => {
  test('returns prepared and deployed shas on success', async () => {
    setCliRuntime({ output: 'json' })
    const result = await runDeploy(cfg, paths, 'demo', undefined, 1000, {
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      createEngine: () =>
        ({
          deploy: async () => ({ deployedSHA: 'deadbeef12345678', durationMs: 42 }),
        }) as never,
    })

    expect(result).toEqual({
      app: 'demo',
      durationMs: 42,
      preparedSha: '12345678deadbeef',
      sha: 'deadbeef12345678',
      workdir: '/tmp/demo',
    })
  })

  test('wraps source prep failures as deploy_failed', async () => {
    setCliRuntime({ output: 'json' })
    await expect(
      runDeploy(cfg, paths, 'demo', undefined, 1000, {
        sync: async () => {
          throw new Error('git clone failed')
        },
      }),
    ).rejects.toMatchObject({
      code: 'deploy_failed',
      message: 'git clone failed',
    })
  })

  test('permission failures hint to rerun sudo jib init', async () => {
    setCliRuntime({ output: 'json' })
    await expect(
      runDeploy(cfg, paths, 'demo', undefined, 1000, {
        sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
        createEngine: () =>
          ({
            deploy: async () => {
              throw new Error("EACCES: permission denied, open '/opt/jib/overrides/demo.yml'")
            },
          }) as never,
      }),
    ).rejects.toMatchObject({
      code: 'deploy_failed',
      hint: 'rerun `sudo jib init` to repair /opt/jib permissions, then retry `jib deploy ...`',
    })
  })
})
