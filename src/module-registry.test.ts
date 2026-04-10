import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import type { Module, ModuleContext } from '@jib/core'
import {
  type FirstPartyModule,
  optionalModules,
  requiredModules,
  resolveModules,
} from './module-registry.ts'

function fakeModule(
  mod: Module<Config> & { manifest: { name: string; required?: boolean } },
): FirstPartyModule {
  return mod
}

describe('module registry projections', () => {
  test('one registry can power init capability views', () => {
    const requiredOnly = fakeModule({
      manifest: { name: 'required-only', required: true },
      install: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const optionalOnly = fakeModule({
      manifest: { name: 'optional-only' },
    })
    const setupModule = fakeModule({
      manifest: { name: 'setup-module' },
      install: async (_ctx: ModuleContext<Config>) => undefined,
      setup: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const registry = [requiredOnly, optionalOnly, setupModule] as const

    expect(requiredModules(registry).map((mod) => mod.manifest.name)).toEqual(['required-only'])
    expect(optionalModules(registry).map((mod) => mod.manifest.name)).toEqual([
      'optional-only',
      'setup-module',
    ])
    expect(
      resolveModules(['setup-module', 'required-only'], registry).map((mod) => mod.manifest.name),
    ).toEqual(['required-only', 'setup-module'])
    expect(typeof resolveModules(['setup-module'], registry)[0]?.setup).toBe('function')
    expect(typeof resolveModules(['setup-module'], registry)[0]?.install).toBe('function')
  })
})
