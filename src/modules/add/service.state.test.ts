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

  for (const [failAt, expectedStates, rollsBack] of [
    ['prepareRepo', ['inputs_ready'], false],
    ['inspectCompose', ['inputs_ready', 'repo_prepared'], true],
    ['collectGuidedInputs', ['inputs_ready', 'repo_prepared', 'compose_inspected'], true],
    [
      'buildResolvedApp',
      ['inputs_ready', 'repo_prepared', 'compose_inspected', 'guided_inputs_collected'],
      true,
    ],
    [
      'confirmPlan',
      [
        'inputs_ready',
        'repo_prepared',
        'compose_inspected',
        'guided_inputs_collected',
        'app_resolved',
      ],
      true,
    ],
    [
      'writeConfig',
      [
        'inputs_ready',
        'repo_prepared',
        'compose_inspected',
        'guided_inputs_collected',
        'app_resolved',
        'confirmed',
      ],
      true,
    ],
  ] as const) {
    test(`failure at ${failAt} cleans up the expected partial state`, async () => {
      const { calls, flow, states } = makeDeps(failAt)

      const result = await flow.run(makeParams())
      expect(result).toBeInstanceOf(Error)
      expect((result as AddFlowError).message).toBe(`${failAt} failed`)
      expect(states).toEqual([...expectedStates])
      expect(calls.includes('rollbackRepo')).toBe(rollsBack)
      expect(calls.some((call) => call.startsWith('removeSecret:'))).toBe(false)
      expect(calls.includes('loadConfig')).toBe(false)
    })
  }
})
