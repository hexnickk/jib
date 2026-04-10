import { describe, expect, test } from 'bun:test'
import { finalApp, makeDeps, makeParams } from './add-flow.shared.ts'

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
      'upsertSecret:TOKEN',
      'claimRoutes',
    ])
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

      await expect(flow.run(makeParams())).rejects.toThrow(`${failAt} failed`)
      expect(states).toEqual([...expectedStates])
      expect(calls.includes('rollbackRepo')).toBe(rollsBack)
      expect(calls.some((call) => call.startsWith('removeSecret:'))).toBe(false)
      expect(calls.includes('loadConfig')).toBe(false)
    })
  }
})
