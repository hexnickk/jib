import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { stateCollectApps, stateManagedServiceNames, stateNormalizeUnitStatus } from './collect.ts'
import { StateError } from './errors.ts'

describe('stateManagedServiceNames', () => {
  test('always includes the watcher service', () => {
    expect(stateManagedServiceNames(false)).toEqual(['jib-watcher'])
  })

  test('includes cloudflared only when the module is enabled', () => {
    expect(stateManagedServiceNames(true)).toEqual(['jib-watcher', 'jib-cloudflared'])
  })
})

describe('stateNormalizeUnitStatus', () => {
  test('preserves one-word systemctl states', () => {
    expect(stateNormalizeUnitStatus('active\n', 0)).toBe('active')
    expect(stateNormalizeUnitStatus('failed\n', 3)).toBe('failed')
  })

  test('maps empty failed output to unavailable', () => {
    expect(stateNormalizeUnitStatus('', 1)).toBe('unavailable')
  })

  test('maps verbose diagnostics to unavailable', () => {
    expect(
      stateNormalizeUnitStatus(
        '"systemd" is not running in this container due to its overhead.\nservice --status-all\n',
        1,
      ),
    ).toBe('unavailable')
  })
})

describe('stateCollectApps', () => {
  test('returns a typed error when one app state file is corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-state-'))
    const paths = pathsGetPaths(root)
    try {
      await mkdir(paths.stateDir, { recursive: true })
      await Bun.write(join(paths.stateDir, 'web.json'), '{not json')
      const cfg = {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {
          web: {
            repo: 'local',
            branch: 'main',
            domains: [],
            env_file: '.env',
          },
        },
      } as Config
      const result = await stateCollectApps(cfg, paths)
      expect(result).toBeInstanceOf(StateError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
