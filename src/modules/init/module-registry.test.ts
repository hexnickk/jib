import { describe, expect, test } from 'bun:test'
import {
  type FirstPartyModule,
  initOptionalModules,
  initRequiredModules,
  initResolveModules,
} from './module-registry.ts'
import type { InitContext } from './types.ts'

function fakeModule(mod: FirstPartyModule): FirstPartyModule {
  return mod
}

describe('module registry projections', () => {
  test('one registry can power init capability views', () => {
    const requiredOnly = fakeModule({
      manifest: { name: 'required-only', required: true },
      install: async (_ctx: InitContext) => undefined,
    })
    const optionalOnly = fakeModule({
      manifest: { name: 'optional-only' },
    })
    const installedOptional = fakeModule({
      manifest: { name: 'installed-optional' },
      install: async (_ctx: InitContext) => undefined,
    })
    const registry = [requiredOnly, optionalOnly, installedOptional] as const

    expect(initRequiredModules(registry).map((mod) => mod.manifest.name)).toEqual(['required-only'])
    expect(initOptionalModules(registry).map((mod) => mod.manifest.name)).toEqual([
      'optional-only',
      'installed-optional',
    ])
    expect(
      initResolveModules(['installed-optional', 'required-only'], registry).map(
        (mod) => mod.manifest.name,
      ),
    ).toEqual(['required-only', 'installed-optional'])
    expect(typeof initResolveModules(['installed-optional'], registry)[0]?.install).toBe('function')
  })
})
