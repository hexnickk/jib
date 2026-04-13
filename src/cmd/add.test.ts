import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliError } from '@jib/cli'
import type { Config } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { addChooseInitialSource } from './add-support.ts'

const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {},
} as Config

const tempDirs: string[] = []
const selectSetup = async <T extends string>(_opts: {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}): Promise<T> => 'setup:github' as T

/** Creates an isolated temp workspace for add command tests. */
function createAddTestPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'jib-add-test-'))
  tempDirs.push(dir)
  return pathsGetPaths(dir)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('addChooseInitialSource', () => {
  test('cancels add when source setup does not complete', async () => {
    const result = await addChooseInitialSource(cfg, createAddTestPaths(), undefined, {
      isInteractive: () => true,
      buildSourceChoices: () => [{ value: 'setup:github', label: 'Set up new GitHub source' }],
      promptSelect: selectSetup,
      runSourceSetup: async () => null,
    })

    expect(result).toMatchObject({
      code: 'cancelled',
      message: 'source setup did not complete; add cancelled',
    } satisfies Partial<CliError>)
  })

  test('returns a newly created source when setup succeeds', async () => {
    await expect(
      addChooseInitialSource(cfg, createAddTestPaths(), undefined, {
        isInteractive: () => true,
        buildSourceChoices: () => [{ value: 'setup:github', label: 'Set up new GitHub source' }],
        promptSelect: selectSetup,
        runSourceSetup: async () => 'chaindynamics-app',
      }),
    ).resolves.toEqual({ value: 'chaindynamics-app', created: true })
  })

  test('uses an existing source without prompting when one was provided', async () => {
    await expect(
      addChooseInitialSource(cfg, createAddTestPaths(), 'existing-source', {
        isInteractive: () => false,
      }),
    ).resolves.toEqual({ value: 'existing-source', created: false })
  })
})
