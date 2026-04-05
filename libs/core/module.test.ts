import { describe, expect, test } from 'bun:test'
import type { ModuleManifest } from './module.ts'

/**
 * `installOrder` is a Stage 3 addition to `ModuleManifest` used by the Stage
 * 5b loader to sort install / setup-hook execution (add ascending, remove
 * descending). Until that loader exists we verify only the schema: the field
 * is optional and typed `number`. These tests double as living docs for the
 * convention so future edits don't silently break it.
 */
describe('ModuleManifest.installOrder', () => {
  test('is optional (manifests without it still type-check)', () => {
    const m: ModuleManifest = { name: 'bare' }
    expect(m.installOrder).toBeUndefined()
  })

  test('accepts a number and preserves it verbatim', () => {
    const m: ModuleManifest = { name: 'cloudflare', installOrder: 10 }
    expect(m.installOrder).toBe(10)
  })

  test('add-asc / remove-desc convention: sorting yields the documented order', () => {
    const manifests: ModuleManifest[] = [
      { name: 'nginx', installOrder: 20 },
      { name: 'cloudflare', installOrder: 10 },
      { name: 'other' }, // default 100
    ]
    const order = (m: ModuleManifest) => m.installOrder ?? 100
    const add = [...manifests].sort((a, b) => order(a) - order(b)).map((m) => m.name)
    const remove = [...manifests].sort((a, b) => order(b) - order(a)).map((m) => m.name)
    expect(add).toEqual(['cloudflare', 'nginx', 'other'])
    expect(remove).toEqual(['other', 'nginx', 'cloudflare'])
  })
})
