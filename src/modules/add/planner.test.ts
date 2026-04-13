import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError } from '@jib/cli'
import type { App, Config } from '@jib/config'
import { getPaths, managedComposePath } from '@jib/paths'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'
import { addCreatePlanner } from './planner.ts'

const draftApp: App = {
  repo: 'owner/demo',
  branch: 'main',
  domains: [],
  env_file: '.env',
}

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {},
}

describe('addCreatePlanner', () => {
  test('offers to generate a compose file from Dockerfile when none exists', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    writeFileSync(join(workdir, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n')

    const planner = addCreatePlanner({
      isInteractive: () => true,
      note: () => {},
      promptConfirm: async () => true,
      promptString: async () => {
        throw new Error('promptString should not be called when scaffold is accepted')
      },
    })

    const inspection = await planner.inspectCompose(draftApp, workdir)
    if (inspection instanceof Error) throw inspection

    expect(inspection.composeFiles).toEqual([GENERATED_COMPOSE_FILE])
    expect(inspection.services.map((service) => service.name)).toEqual(['app'])
    expect(inspection.services[0]?.expose).toEqual(['3000'])
  })

  test('persists generated compose outside the repo when building the final app', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jib-planner-paths-'))
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    const paths = getPaths(root)
    writeFileSync(
      join(workdir, GENERATED_COMPOSE_FILE),
      'services:\n  app:\n    build:\n      context: .\n',
    )

    const planner = addCreatePlanner()
    const app = await planner.buildResolvedApp(
      cfg,
      paths,
      'demo',
      workdir,
      {},
      {
        repo: 'owner/demo',
        persistPaths: [],
        ingressDefault: 'direct',
        parsedDomains: [],
        configEntries: [],
        healthChecks: [],
      },
      {
        composeFiles: [GENERATED_COMPOSE_FILE],
        services: [{ name: 'app', ports: [], expose: [], envRefs: [], buildArgRefs: [] }],
      },
      { domains: [], configEntries: [] },
    )
    if (app instanceof Error) throw app

    expect(app.compose).toEqual([managedComposePath(paths, 'demo')])
  })

  test('falls back to prompting for compose paths when scaffold is declined', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    writeFileSync(join(workdir, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n')
    writeFileSync(join(workdir, 'compose.yml'), 'services:\n  web:\n    image: nginx\n')

    const planner = addCreatePlanner({
      isInteractive: () => true,
      note: () => {},
      promptConfirm: async () => false,
      promptString: async () => 'compose.yml',
    })

    const inspection = await planner.inspectCompose(draftApp, workdir)
    if (inspection instanceof Error) throw inspection

    expect(inspection.composeFiles).toEqual(['compose.yml'])
    expect(inspection.services.map((service) => service.name)).toEqual(['web'])
  })

  test('rejects compose files with host bind mounts', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-planner-'))
    writeFileSync(
      join(workdir, 'docker-compose.yml'),
      'services:\n  web:\n    image: nginx\n    volumes:\n      - /data/sqlite:/data/sqlite\n',
    )

    const planner = addCreatePlanner()

    expect(await planner.inspectCompose(draftApp, workdir)).toBeInstanceOf(CliError)
  })
})
