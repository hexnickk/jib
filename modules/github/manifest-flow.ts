import { JibError } from '@jib/core'
import { $ } from 'bun'

export interface ManifestResult {
  appId: number
  slug: string
  pem: string
}

interface ManifestPayload {
  name: string
  url: string
  hook_attributes: { active: boolean }
  redirect_url: string
  public: boolean
  default_permissions: Record<string, string>
  default_events: string[]
}

function buildManifest(providerName: string, callback: string): ManifestPayload {
  return {
    name: `jib-${providerName}`,
    url: 'https://github.com/hexnickk/jib',
    hook_attributes: { active: false },
    redirect_url: callback,
    public: false,
    default_permissions: { contents: 'read' },
    default_events: [],
  }
}

const FIVE_MIN = 5 * 60 * 1000

/**
 * Runs GitHub's App manifest flow: spins up an ephemeral local HTTP server,
 * opens the user's browser to a self-submitting form that POSTs the manifest
 * to GitHub, then waits for the redirect back with a code to exchange for
 * the App's PEM + ID. Times out after 5 minutes. Reference:
 * `_legacy/cmd/jib/github_manifest.go`.
 */
export async function runManifestFlow(providerName: string): Promise<ManifestResult> {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')

  const { promise, resolve, reject } = Promise.withResolvers<string>()
  // We can't know the bound port until `Bun.serve` returns, but the fetch
  // handler closes over the URLs. Resolve via late-bound refs so the handler
  // uses the final value once the server is up.
  let callback = ''
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req: Request): Response {
      const url = new URL(req.url)
      if (url.pathname === '/callback') {
        if (url.searchParams.get('state') !== state) {
          reject(new JibError('github.manifest', 'state mismatch'))
          return new Response('invalid state', { status: 400 })
        }
        const code = url.searchParams.get('code')
        if (!code) {
          reject(new JibError('github.manifest', 'missing code'))
          return new Response('missing code', { status: 400 })
        }
        resolve(code)
        return htmlResponse(
          '<h2>GitHub App created!</h2><p>You can close this tab and return to the terminal.</p>',
        )
      }
      return htmlResponse(renderForm(state, JSON.stringify(buildManifest(providerName, callback))))
    },
  })

  callback = `http://localhost:${server.port}/callback`
  const formURL = `http://localhost:${server.port}/`
  const timer = setTimeout(() => reject(new JibError('github.manifest', 'timed out')), FIVE_MIN)
  try {
    await openBrowser(formURL)
  } catch {
    console.log(`Open this URL to continue:\n  ${formURL}\n`)
  }

  try {
    const code = await promise
    return await exchangeCode(code)
  } finally {
    clearTimeout(timer)
    server.stop(true)
  }
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderForm(state: string, manifestJSON: string): string {
  const esc = escapeHTML(manifestJSON)
  const stateEsc = escapeHTML(state)
  return `<!DOCTYPE html><html><body>
<h2>Creating GitHub App...</h2>
<form id="mf" action="https://github.com/settings/apps/new?state=${stateEsc}" method="post">
<input type="hidden" name="manifest" value="${esc}">
<button type="submit">Create GitHub App</button>
</form>
<script>document.getElementById('mf').submit();</script>
</body></html>`
}

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function exchangeCode(code: string): Promise<ManifestResult> {
  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'jib' },
  })
  if (res.status !== 201) {
    throw new JibError('github.manifest', `HTTP ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { id: number; slug: string; pem: string }
  if (!data.pem) throw new JibError('github.manifest', 'no PEM returned')
  return { appId: data.id, slug: data.slug, pem: data.pem }
}

async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const res = await $`${cmd} ${url}`.quiet().nothrow()
  if (res.exitCode !== 0) throw new JibError('github.manifest', 'failed to open browser')
}
