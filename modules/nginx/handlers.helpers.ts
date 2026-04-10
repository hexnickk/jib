import { createLogger, getPaths } from '@jib/core'
import type { CertExistsFn, ExecFn, ExecResult } from '@jib/ingress'
import { FakeBus, flush } from '@jib/rpc'
import { registerNginxHandlers } from './handlers.ts'

/**
 * Shared test helpers for the nginx operator handler suites.
 *
 * The claim and release behaviours live in sibling test files
 * (`handlers.claim.test.ts`, `handlers.release.test.ts`) so each file stays
 * under the 200 LoC cap. This module is test-only — it's imported by the
 * `*.test.ts` files and never shipped in the production bundle.
 */

export interface TestCtx {
  tmpRoot: string
  calls: string[][]
}

export function fakeExec(ctx: TestCtx, map: (cmd: string) => ExecResult): ExecFn {
  return async (argv) => {
    ctx.calls.push(argv)
    return map(argv[0] ?? '')
  }
}

export async function waitFor<T>(fn: () => T | undefined, max = 30): Promise<T> {
  for (let i = 0; i < max; i++) {
    const v = fn()
    if (v !== undefined) return v
    await flush()
  }
  throw new Error('timed out')
}

export const noCerts: CertExistsFn = async () => false

export function setup(ctx: TestCtx, exec: ExecFn, certExists: CertExistsFn = noCerts) {
  const bus = new FakeBus()
  const paths = getPaths(ctx.tmpRoot)
  const disposer = registerNginxHandlers(bus.asBus(), {
    paths,
    log: createLogger('nginx-test'),
    exec,
    certExists,
  })
  return { bus, paths, disposer }
}

export function claim(app: string) {
  return {
    corrId: `c-${app}`,
    ts: new Date().toISOString(),
    source: 'test',
    app,
    domains: [{ host: `${app}.example.com`, port: 8080 }],
  }
}
