import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathsGetPaths } from '@jib/paths'
import type { AddFlowError } from './flow-errors.ts'
import { CancelledAddError } from './flow-errors.ts'
import { addFinalApp, addMakeDeps, addMakeParams } from './service.test-support.ts'

describe('add flow state machine', () => {
  test('success visits each state in order', async () => {
    const { calls, flow, states } = addMakeDeps()

    const result = await flow.run(addMakeParams())

    expect(result).toEqual({ finalApp: addFinalApp, secretsWritten: 2 })
    expect(states).toEqual([
      'inputs_ready',
      'repo_prepared',
      'compose_inspected',
      'guided_inputs_collected',
      'app_resolved',
      'confirmed',
      'config_written',
      'secrets_written',
      'routes_claimed',
    ])
    expect(calls).toEqual([
      'prepareRepo',
      'inspectCompose',
      'collectGuidedInputs',
      'buildResolvedApp',
      'confirmPlan',
      'writeConfig',
      'upsertSecret:APP_KEY',
      'upsertSecret:PUBLIC_URL',
      'claimRoutes',
    ])
  })

  test('cancellation after config write rolls back completed steps', async () => {
    const { calls, flow, states } = addMakeDeps()

    const result = await flow.run({
      ...addMakeParams(),
      signal: {
        get cancelled() {
          return states.includes('config_written')
        },
      },
    })

    expect(result).toBeInstanceOf(CancelledAddError)
    expect(calls).toContain('rollbackRepo')
    expect(calls).toContain('loadConfig')
  })

  test('failure before config write rolls back prepared repo without partial cleanup noise', async () => {
    const { calls, flow, states } = addMakeDeps('buildResolvedApp')

    const result = await flow.run(addMakeParams())
    expect(result).toBeInstanceOf(Error)
    expect((result as AddFlowError).message).toBe('buildResolvedApp failed')
    expect(states).toEqual([
      'inputs_ready',
      'repo_prepared',
      'compose_inspected',
      'guided_inputs_collected',
    ])
    expect(calls.includes('rollbackRepo')).toBe(true)
    expect(calls.some((call) => call.startsWith('removeSecret:'))).toBe(false)
    expect(calls.includes('loadConfig')).toBe(false)
  })

  test('docker hub workdir preparation failures return PrepareRepoError', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-add-dockerhub-'))
    const { flow } = addMakeDeps()

    try {
      const paths = pathsGetPaths(root)
      await mkdir(paths.reposDir, { recursive: true })
      await writeFile(join(paths.reposDir, 'local'), 'not-a-directory')

      const params = addMakeParams()
      const result = await flow.run({
        ...params,
        paths,
        inputs: { ...params.inputs, repo: 'docker://n8nio/n8n' },
      })

      expect(result).toBeInstanceOf(Error)
      expect((result as AddFlowError).code).toBe('add_prepare_repo')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
