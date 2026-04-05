import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import type { Logger } from '@jib/core'
import { SUBJECTS, emitAndWait } from '@jib/rpc'

/**
 * HTTP receiver for GitHub push webhooks. Verifies the `X-Hub-Signature-256`
 * HMAC, resolves `repo/ref` → app via the loaded config, then chains
 * `cmd.repo.prepare` → `cmd.deploy` through the bus — identical to the flow
 * `jib deploy` runs from the CLI. This keeps the "one state machine per
 * trigger source" invariant (CLI, gitsitter poll, webhook).
 */

export interface WebhookServerDeps {
  bus: Bus
  /** Getter so callers can swap the config on `cmd.config.reload` without re-binding. */
  getConfig: () => Config
  secret: string
  log: Logger
  source?: string
}

interface PushPayload {
  ref?: string
  after?: string
  repository?: { full_name?: string }
}

export function verifySignature(secret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  const got = header.slice('sha256='.length)
  if (got.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'))
}

/** Maps `(repo, ref)` → first app whose config matches. Returns undefined if none. */
export function findAppForPush(
  config: Config,
  repo: string,
  ref: string,
): { app: string } | undefined {
  const branch = ref.replace(/^refs\/heads\//, '')
  for (const [name, app] of Object.entries(config.apps)) {
    if (app.repo === repo && app.branch === branch) return { app: name }
  }
  return undefined
}

/**
 * Handle a single HTTP request. Split out from `start` so tests can call it
 * without spinning up a real TCP listener. Returns the response.
 */
export async function handleRequest(req: Request, deps: WebhookServerDeps): Promise<Response> {
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/webhooks/jib') {
    return new Response('not found', { status: 404 })
  }
  const delivery = req.headers.get('x-github-delivery') ?? 'unknown'
  const body = await req.text()
  const sig = req.headers.get('x-hub-signature-256')
  if (!verifySignature(deps.secret, body, sig)) {
    deps.log.warn(`rejected webhook ${delivery}: bad signature`)
    return new Response('bad signature', { status: 401 })
  }
  if (req.headers.get('x-github-event') !== 'push') {
    return new Response('ignored', { status: 200 })
  }
  const payload = JSON.parse(body) as PushPayload
  const repo = payload.repository?.full_name
  const ref = payload.ref
  const sha = payload.after
  if (!repo || !ref || !sha) return new Response('malformed push payload', { status: 400 })
  // Tag pushes (`refs/tags/...`) aren't branch deploys — silent skip for now.
  if (!ref.startsWith('refs/heads/')) {
    deps.log.info(`${delivery}: non-branch ref ${ref} — ignored`)
    return new Response('non-branch ref', { status: 200 })
  }
  const match = findAppForPush(deps.getConfig(), repo, ref)
  if (!match) {
    deps.log.info(`${delivery}: no app for ${repo}@${ref} — ignored`)
    return new Response('no matching app', { status: 200 })
  }
  void dispatchDeploy(match.app, sha, deps).catch((err) =>
    deps.log.error(`${delivery}: webhook deploy failed: ${(err as Error).message}`),
  )
  return new Response('accepted', { status: 202 })
}

async function dispatchDeploy(app: string, sha: string, deps: WebhookServerDeps): Promise<void> {
  const source = deps.source ?? 'webhook'
  deps.log.info(`${app}: cmd.repo.prepare @ ${sha}`)
  const ready = await emitAndWait(
    deps.bus,
    SUBJECTS.cmd.repoPrepare,
    { app, ref: sha },
    { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
    undefined,
    { source, timeoutMs: 5 * 60_000 },
  )
  deps.log.info(`${app}: cmd.deploy (workdir=${ready.workdir})`)
  await emitAndWait(
    deps.bus,
    SUBJECTS.cmd.deploy,
    { app, workdir: ready.workdir, sha: ready.sha, trigger: 'webhook' },
    { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
    SUBJECTS.evt.deployProgress,
    { source, timeoutMs: 30 * 60_000 },
  )
  deps.log.info(`${app}: deploy ok`)
}

export interface ServeOpts extends WebhookServerDeps {
  listen: string
}

export function serve(opts: ServeOpts): { stop: () => Promise<void> } {
  const [host, portStr] = parseListen(opts.listen)
  const server = Bun.serve({
    hostname: host,
    port: Number(portStr),
    fetch: (req) => handleRequest(req, opts),
  })
  opts.log.info(`webhook listening on ${server.hostname}:${server.port}`)
  return { stop: async () => void server.stop() }
}

function parseListen(v: string): [string, string] {
  const s = v.startsWith(':') ? `0.0.0.0${v}` : v
  const idx = s.lastIndexOf(':')
  return [s.slice(0, idx), s.slice(idx + 1)]
}
