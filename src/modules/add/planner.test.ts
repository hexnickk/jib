import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from '@jib/config'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'
import { createAddPlanner } from './planner.ts'

const draftApp: App = {
  repo: 'owner/demo',
  branch: 'main',
  domains: [],
  env_file: '.env',
}

describe('createAddPlanner', () => {
  test('offers to generate a compose file from Dockerfile when none exists', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    writeFileSync(join(workdir, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n')

    const planner = createAddPlanner({
      isInteractive: () => true,
      note: () => {},
      promptConfirm: async () => true,
      promptString: async () => {
        throw new Error('promptString should not be called when scaffold is accepted')
      },
    })

    const inspection = await planner.inspectCompose(draftApp, workdir)

    expect(inspection.composeFiles).toEqual([GENERATED_COMPOSE_FILE])
    expect(inspection.services.map((service) => service.name)).toEqual(['app'])
    expect(inspection.services[0]?.expose).toEqual(['3000'])
  })

  test('falls back to prompting for compose paths when scaffold is declined', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    writeFileSync(join(workdir, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n')
    writeFileSync(join(workdir, 'compose.yml'), 'services:\n  web:\n    image: nginx\n')

    const planner = createAddPlanner({
      isInteractive: () => true,
      note: () => {},
      promptConfirm: async () => false,
      promptString: async () => 'compose.yml',
    })

    const inspection = await planner.inspectCompose(draftApp, workdir)

    expect(inspection.composeFiles).toEqual(['compose.yml'])
    expect(inspection.services.map((service) => service.name)).toEqual(['web'])
  })
})
