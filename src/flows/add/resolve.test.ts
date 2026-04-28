import { afterEach, describe, expect, test } from 'bun:test'
import { cliSetRuntime } from '@jib/cli'
import type { ComposeService } from '@jib/docker'
import { addCollectGuidedInputs } from './resolve.ts'
import type { AddInputs, ConfigEntry } from './types.ts'

const debugEnv = process.env.JIB_DEBUG

/** Restores CLI runtime state changed by non-interactive guided-input tests. */
function restoreRuntime(): void {
  cliSetRuntime({ interactive: 'auto', debug: false, stdinTty: true, stdoutTty: true })
  if (debugEnv === undefined) Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  else process.env.JIB_DEBUG = debugEnv
}

afterEach(restoreRuntime)

function inputs(configEntries: ConfigEntry[] = []): AddInputs {
  return {
    repo: 'owner/demo',
    persistPaths: [],
    ingressDefault: 'direct',
    parsedDomains: [],
    configEntries,
    healthChecks: [],
  }
}

function service(partial: Partial<ComposeService> = {}): ComposeService {
  return {
    name: 'web',
    ports: [],
    expose: [],
    envRefs: [],
    buildArgRefs: [],
    ...partial,
  }
}

describe('addCollectGuidedInputs', () => {
  test('treats detected compose env refs as optional without prompts', async () => {
    cliSetRuntime({ interactive: 'never', debug: false, stdinTty: true, stdoutTty: true })

    const result = await addCollectGuidedInputs(inputs(), [
      service({ envRefs: ['TELEGRAM_BOT_TOKEN'] }),
    ])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.configEntries).toEqual([])
  })

  test('keeps env entries supplied by CLI args', async () => {
    cliSetRuntime({ interactive: 'never', debug: false, stdinTty: true, stdoutTty: true })
    const envEntry = {
      key: 'TELEGRAM_BOT_TOKEN',
      value: 'token',
      scope: 'runtime' as const,
    }

    const result = await addCollectGuidedInputs(inputs([envEntry]), [service()])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.configEntries).toEqual([envEntry])
  })
})
