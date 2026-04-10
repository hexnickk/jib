import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { getPaths } from '@jib/core'
import {
  buildGitHubProviderChoices,
  isGitHubAuthFailure,
  maybeRecoverGitHubProvider,
} from '../add-github.ts'

const paths = getPaths('/tmp/jib-add-github-test')
const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  apps: {},
  github: {
    providers: {
      appy: { type: 'app', app_id: 1 },
      keyy: { type: 'key' },
    },
  },
} as Config

describe('GitHub provider recovery', () => {
  test('lists existing providers before setup options', () => {
    expect(buildGitHubProviderChoices(cfg)).toEqual([
      { value: 'existing:appy', label: 'appy', hint: 'GitHub App' },
      { value: 'existing:keyy', label: 'keyy', hint: 'deployment key' },
      { value: 'setup:key', label: 'Set up new GitHub deployment key' },
      { value: 'setup:app', label: 'Set up new GitHub app' },
    ])
  })

  test('existing provider can be selected after an auth-shaped clone failure', async () => {
    const provider = await maybeRecoverGitHubProvider(
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

    expect(provider).toBe('keyy')
  })

  test('new deploy-key setup can create a provider and confirm retry', async () => {
    const calls: string[] = []

    const provider = await maybeRecoverGitHubProvider(
      cfg,
      paths,
      'acme/private',
      new Error('git clone: Permission denied (publickey)'),
      undefined,
      {
        isInteractive: () => true,
        promptSelect: async () => 'setup:key',
        setupDeployKey: async () => {
          calls.push('setup:key')
          return 'fresh-key'
        },
        promptConfirm: async () => {
          calls.push('confirm')
          return true
        },
      },
    )

    expect(provider).toBe('fresh-key')
    expect(calls).toEqual(['setup:key', 'confirm'])
  })

  test('non-auth failures do not trigger provider recovery', async () => {
    const provider = await maybeRecoverGitHubProvider(
      cfg,
      paths,
      'acme/private',
      new Error('compose file missing'),
      undefined,
      { isInteractive: () => true },
    )

    expect(provider).toBeNull()
    expect(isGitHubAuthFailure(new Error('compose file missing'))).toBe(false)
  })

  test('missing provider config can still recover via the chooser', async () => {
    const prompts: string[] = []

    const provider = await maybeRecoverGitHubProvider(
      cfg,
      paths,
      'acme/private',
      new Error('provider "ghost" not found in config'),
      'ghost',
      {
        isInteractive: () => true,
        promptSelect: async (opts) => {
          prompts.push(opts.message)
          expect(opts.initialValue).toBeUndefined()
          return 'existing:appy'
        },
      },
    )

    expect(provider).toBe('appy')
    expect(prompts).toHaveLength(1)
  })
})
