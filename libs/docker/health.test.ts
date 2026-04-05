import { describe, expect, test } from 'bun:test'
import { allHealthy, buildEndpoint, checkHealth } from './health.ts'

function mockFetch(sequence: Array<{ status: number } | { throw: Error }>): {
  fn: typeof fetch
  calls: number
} {
  const state = { calls: 0 }
  const fn = (async () => {
    const entry = sequence[state.calls] ?? sequence[sequence.length - 1]
    state.calls++
    if (entry && 'throw' in entry) throw entry.throw
    return new Response(null, { status: entry?.status ?? 500 })
  }) as unknown as typeof fetch
  return {
    fn,
    get calls() {
      return state.calls
    },
  }
}

const noSleep = async (_ms: number) => {}

describe('buildEndpoint', () => {
  test('formats localhost URL from HealthCheck', () => {
    expect(buildEndpoint({ path: '/ready', port: 3000 })).toBe('http://localhost:3000/ready')
  })
})

describe('checkHealth', () => {
  test('first 200 wins, no retries', async () => {
    const { fn, calls } = mockFetch([{ status: 200 }])
    const res = await checkHealth([{ path: '/h', port: 1 }], {
      fetchFn: fn,
      sleep: noSleep,
      intervalsMs: [0, 0, 0],
    })
    expect(res[0]?.ok).toBe(true)
    expect(res[0]?.statusCode).toBe(200)
    void calls
  })

  test('retries on 5xx then succeeds', async () => {
    const { fn } = mockFetch([{ status: 503 }, { status: 503 }, { status: 200 }])
    const res = await checkHealth([{ path: '/h', port: 1 }], {
      fetchFn: fn,
      sleep: noSleep,
      intervalsMs: [0, 0, 0, 0, 0],
    })
    expect(res[0]?.ok).toBe(true)
  })

  test('gives up after last interval and surfaces error', async () => {
    const { fn } = mockFetch([{ throw: new Error('ECONNREFUSED') }])
    const res = await checkHealth([{ path: '/h', port: 1 }], {
      fetchFn: fn,
      sleep: noSleep,
      intervalsMs: [0, 0],
    })
    expect(res[0]?.ok).toBe(false)
    expect(res[0]?.error).toContain('ECONNREFUSED')
  })

  test('allHealthy aggregates results', () => {
    expect(
      allHealthy([
        { endpoint: 'x', ok: true },
        { endpoint: 'y', ok: true },
      ]),
    ).toBe(true)
    expect(
      allHealthy([
        { endpoint: 'x', ok: true },
        { endpoint: 'y', ok: false },
      ]),
    ).toBe(false)
    expect(allHealthy([])).toBe(false)
  })
})
