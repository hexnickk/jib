import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { getPaths } from '@jib/core'
import { buildSourceChoices, isSourceAuthFailure, maybeRecoverSource } from '../sources-flow.ts'

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
      { value: 'setup:github:key', label: 'Set up new GitHub deploy key' },
      { value: 'setup:github:app', label: 'Set up new GitHub app' },
    ])
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
        promptSelect: async () => 'setup:github:key',
        runSetup: async (_cfg, _paths, value) => {
          calls.push(`setup:${value}`)
          expect(value).toBe('github:key')
          return 'fresh-key'
        },
        promptConfirm: async () => {
          calls.push('confirm')
          return true
        },
      },
    )

    expect(source).toBe('fresh-key')
    expect(calls).toEqual(['setup:github:key', 'confirm'])
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
})
