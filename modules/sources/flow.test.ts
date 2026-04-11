import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { type Paths, getPaths } from '@jib/core'
import {
  buildSourceChoices,
  isSourceAuthFailure,
  maybeRecoverSource,
  preflightSourceSelection,
  setupSourceRef,
} from './flow.ts'
import type { SourceTarget } from './types.ts'

const paths = getPaths('/tmp/jib-add-github-test')
const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {
    appy: { driver: 'github', type: 'app', app_id: 1 },
    keyy: { driver: 'github', type: 'key' },
  },
  apps: {},
} as Config

describe('source recovery', () => {
  test('lists existing sources before setup options', () => {
    expect(buildSourceChoices(cfg)).toEqual([
      { value: 'existing:appy', label: 'appy', hint: 'GitHub App' },
      { value: 'existing:keyy', label: 'keyy', hint: 'GitHub deployment key' },
      { value: 'setup:github', label: 'Set up new GitHub source' },
    ])
  })

  test('setupSourceRef uses the shared driver setup flow when available', async () => {
    const source = await setupSourceRef(cfg, paths, {
      runSetup: async (_cfg, _paths, value) => {
        expect(value).toBe('github')
        return 'fresh-source'
      },
    })

    expect(source).toBe('fresh-source')
  })

  test('existing source can be selected after an auth-shaped clone failure', async () => {
    const source = await maybeRecoverSource(
      cfg,
      paths,
      'acme/private',
      new Error('git clone: Repository not found'),
      undefined,
      {
        isInteractive: () => true,
        promptSelect: async () => 'existing:keyy',
      },
    )

    expect(source).toBe('keyy')
  })

  test('new deploy-key setup can create a source and confirm retry', async () => {
    const calls: string[] = []

    const source = await maybeRecoverSource(
      cfg,
      paths,
      'acme/private',
      new Error('git clone: Permission denied (publickey)'),
      undefined,
      {
        isInteractive: () => true,
        promptSelect: async () => 'setup:github',
        runSetup: async (_cfg, _paths, value) => {
          calls.push(`setup:${value}`)
          expect(value).toBe('github')
          return 'fresh-key'
        },
        promptConfirm: async () => {
          calls.push('confirm')
          return true
        },
      },
    )

    expect(source).toBe('fresh-key')
    expect(calls).toEqual(['setup:github', 'confirm'])
  })

  test('non-auth failures do not trigger source recovery', async () => {
    const source = await maybeRecoverSource(
      cfg,
      paths,
      'acme/private',
      new Error('compose file missing'),
      undefined,
      { isInteractive: () => true },
    )

    expect(source).toBeNull()
    expect(isSourceAuthFailure('acme/private', new Error('compose file missing'))).toBe(false)
  })

  test('missing source config can still recover via the chooser', async () => {
    const prompts: string[] = []

    const source = await maybeRecoverSource(
      cfg,
      paths,
      'acme/private',
      new Error('source "ghost" not found in config'),
      'ghost',
      {
        isInteractive: () => true,
        promptSelect: async (opts: {
          message: string
          initialValue?: `existing:${string}` | `setup:${string}`
        }) => {
          prompts.push(opts.message)
          expect(opts.initialValue).toBeUndefined()
          return 'existing:appy'
        },
      },
    )

    expect(source).toBe('appy')
    expect(prompts).toHaveLength(1)
  })

  test('preflightSourceSelection retries probe after choosing a new source', async () => {
    const loads: string[] = []
    const probed: string[] = []
    const result = await preflightSourceSelection(
      'demo',
      cfg,
      paths,
      'acme/private',
      undefined,
      undefined,
      {
        isInteractive: () => true,
        promptSelect: async () => 'existing:keyy',
        probe: async (_cfg: Config, _paths: Paths, target: SourceTarget) => {
          probed.push(target.source ?? 'none')
          if (!target.source) throw new Error('git clone: Repository not found')
          return {
            branch: 'main',
            workdir: '/tmp/demo',
            sha: 'abc123abc123abc123abc123abc123abc123abc1',
          }
        },
        loadConfig: async (configFile) => {
          loads.push(configFile)
          return cfg
        },
      },
    )

    expect(result).toEqual({ cfg, source: 'keyy', branch: 'main' })
    expect(loads).toEqual([paths.configFile])
    expect(probed).toEqual(['none', 'keyy'])
  })

  test('preflightSourceSelection returns the detected branch', async () => {
    const result = await preflightSourceSelection(
      'demo',
      cfg,
      paths,
      '/tmp/demo.git',
      undefined,
      undefined,
      {
        probe: async () => ({
          branch: 'master',
          workdir: '/tmp/demo',
          sha: 'abc123abc123abc123abc123abc123abc123abc1',
        }),
      },
    )

    expect(result).toEqual({ cfg, branch: 'master' })
  })
})
