import type { HealthCheck } from '@jib/config'

export interface HealthResult {
  endpoint: string
  ok: boolean
  statusCode?: number
  error?: string
}

/** Retry intervals (ms) matching the Go implementation: 3s, 6s, 12s, 24s, 48s. */
const RETRY_INTERVALS_MS = [3_000, 6_000, 12_000, 24_000, 48_000]

export interface CheckHealthOptions {
  warmupMs?: number
  requestTimeoutMs?: number
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injected for tests. Defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Override retry schedule (tests pass `[0, 0, ...]` to stay fast). */
  intervalsMs?: number[]
}

/** Maps one configured health check to the localhost URL jib probes after deploy. */
export function dockerBuildEndpoint(check: HealthCheck): string {
  return `http://localhost:${check.port}${check.path}`
}

/**
 * Runs each health check with exponential backoff retries. Every check must
 * pass for the deploy to be considered healthy.
 */
export async function dockerCheckHealth(
  checks: HealthCheck[],
  opts: CheckHealthOptions = {},
): Promise<HealthResult[]> {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const intervals = opts.intervalsMs ?? RETRY_INTERVALS_MS
  const requestTimeoutMs = opts.requestTimeoutMs ?? 5_000

  if (opts.warmupMs && opts.warmupMs > 0) await sleep(opts.warmupMs)

  const results: HealthResult[] = []
  for (const check of checks) {
    results.push(await probe(check, fetchFn, sleep, intervals, requestTimeoutMs))
  }
  return results
}

async function probe(
  check: HealthCheck,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  intervals: number[],
  requestTimeoutMs: number,
): Promise<HealthResult> {
  const endpoint = dockerBuildEndpoint(check)
  let lastError: string | undefined
  let lastStatus: number | undefined
  for (let attempt = 0; attempt < intervals.length; attempt++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), requestTimeoutMs)
      const res = await fetchFn(endpoint, { signal: ctrl.signal })
      clearTimeout(t)
      lastStatus = res.status
      if (res.status >= 200 && res.status < 300) {
        return { endpoint, ok: true, statusCode: res.status }
      }
      lastError = `unhealthy status: ${res.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < intervals.length - 1) await sleep(intervals[attempt] ?? 0)
  }
  const out: HealthResult = { endpoint, ok: false }
  if (lastStatus !== undefined) out.statusCode = lastStatus
  if (lastError !== undefined) out.error = lastError
  return out
}

/** Matches Go: returns true on an empty list (no checks configured = healthy). */
export function dockerAllHealthy(results: HealthResult[]): boolean {
  return results.every((r) => r.ok)
}
