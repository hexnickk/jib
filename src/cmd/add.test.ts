import { describe, expect, test } from 'bun:test'
import type { CliError } from '@jib/cli'
import type { Config } from '@jib/config'
import { getPaths } from '@jib/paths'
import { chooseInitialSource } from './add.ts'

const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {},
} as Config

const selectSetup = async <T extends string>(): Promise<T> => 'setup:github' as T

describe('chooseInitialSource', () => {
  test('cancels add when source setup does not complete', async () => {
    const paths = getPaths('/tmp/jib-add-test')

    await expect(
      chooseInitialSource(cfg, paths, undefined, {
        isInteractive: () => true,
        buildSourceChoices: () => [{ value: 'setup:github', label: 'Set up new GitHub source' }],
        promptSelect: selectSetup,
        runSourceSetup: async () => null,
      }),
    ).rejects.toMatchObject({
      code: 'cancelled',
      message: 'source setup did not complete; add cancelled',
    } satisfies Partial<CliError>)
  })

  test('returns a newly created source when setup succeeds', async () => {
    const paths = getPaths('/tmp/jib-add-test')

    await expect(
      chooseInitialSource(cfg, paths, undefined, {
        isInteractive: () => true,
        buildSourceChoices: () => [{ value: 'setup:github', label: 'Set up new GitHub source' }],
        promptSelect: selectSetup,
        runSourceSetup: async () => 'chaindynamics-app',
      }),
    ).resolves.toEqual({ value: 'chaindynamics-app', created: true })
  })

  test('uses an existing source without prompting when one was provided', async () => {
    const paths = getPaths('/tmp/jib-add-test')

    await expect(
      chooseInitialSource(cfg, paths, 'existing-source', {
        isInteractive: () => false,
      }),
    ).resolves.toEqual({ value: 'existing-source', created: false })
  })
})
