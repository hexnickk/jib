import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { describe, expect, test } from 'vitest'
import { DeployPrepareError } from './errors.ts'
import { runDeploy, runDeployResult } from './run.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [] },
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
  composeDir: '/opt/jib/compose',
  reposDir: '/opt/jib/repos',
  secretsDir: '/opt/jib/secrets',
  stateDir: '/opt/jib/state',
}

/** Creates a no-op spinner so deploy unit tests do not write progress output. */
function createNoopSpinner() {
  return {
    start() {},
    message() {},
    stop() {},
  }
}

describe('runDeploy', () => {
  test('returns prepared and deployed shas on success', async () => {
    const result = await runDeploy(cfg, paths, 'demo', undefined, {
      createSpinner: createNoopSpinner,
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      deployPrepared: async () => ({ deployedSHA: 'deadbeef12345678', durationMs: 42 }),
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
    await expect(
      runDeploy(cfg, paths, 'demo', undefined, {
        createSpinner: createNoopSpinner,
        sync: async () => {
          throw new Error('git clone failed')
        },
      }),
    ).rejects.toMatchObject({
      code: 'deploy_failed',
      message: 'git clone failed',
    })
  })

  test('returns a typed prepare error instead of throwing for expected sync failures', async () => {
    const result = await runDeployResult(cfg, paths, 'demo', undefined, {
      createSpinner: createNoopSpinner,
      sync: async () => {
        throw new Error('git clone failed')
      },
    })

    expect(result).toBeInstanceOf(DeployPrepareError)
    expect(result).toMatchObject({
      code: 'deploy_prepare_failed',
      message: 'git clone failed',
    })
  })

  test('permission failures hint to repair the managed tree', async () => {
    await expect(
      runDeploy(cfg, paths, 'demo', undefined, {
        createSpinner: createNoopSpinner,
        sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
        deployPrepared: async () => {
          throw new Error("EACCES: permission denied, open '/opt/jib/overrides/demo.yml'")
        },
      }),
    ).rejects.toMatchObject({
      code: 'deploy_failed',
      hint: 'repair /opt/jib ownership and permissions, then retry `jib deploy ...`',
    })
  })
})
