import { describe, expect, test } from 'bun:test'
import type { AddFlowError } from './flow-errors.ts'
import { CancelledAddError } from './flow-errors.ts'
import { finalApp, makeDeps, makeParams } from './service.test-support.ts'

describe('add flow state machine', () => {
  test('success visits each state in order', async () => {
    const { calls, flow, states } = makeDeps()

    const result = await flow.run(makeParams())

    expect(result).toEqual({ finalApp, secretsWritten: 2 })
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
    const { calls, flow, states } = makeDeps()

    const result = await flow.run({
      ...makeParams(),
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
    const { calls, flow, states } = makeDeps('buildResolvedApp')

    const result = await flow.run(makeParams())
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
})
