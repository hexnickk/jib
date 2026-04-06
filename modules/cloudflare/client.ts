/**
 * Minimal Cloudflare v4 API client — just the endpoints jib needs for tunnel
 * management. Intentionally not a generated SDK: the surface we touch is
 * small enough that hand-typed zod envelopes give better errors, and we
 * avoid another transitive dep inside the compiled binary.
 */

export interface Tunnel {
  id: string
  name: string
}

interface Envelope<T> {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result?: T
}

/**
 * Minimal fetch shape used by the client. Typed as a plain function rather
 * than `typeof fetch` so tests can pass a stub without having to implement
 * Bun's `preconnect` extension.
 */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface CloudflareClientOpts {
  token: string
  baseUrl?: string
  fetchFn?: FetchFn
}

const DEFAULT_BASE = 'https://api.cloudflare.com/client/v4'

export class CloudflareClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly fetchFn: FetchFn

  constructor(opts: CloudflareClientOpts) {
    this.token = opts.token
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE
    this.fetchFn = opts.fetchFn ?? fetch
  }

  /** Verifies the token is active and returns the first account ID. */
  async verifyToken(): Promise<{ accountId: string }> {
    const status = await this.request<{ status: string }>('GET', '/user/tokens/verify')
    if (status.status !== 'active') {
      throw new Error(`cloudflare token status is "${status.status}", expected "active"`)
    }
    const accounts = await this.request<Array<{ id: string; name: string }>>(
      'GET',
      '/accounts?per_page=1',
    )
    const first = accounts[0]
    if (!first) throw new Error('no cloudflare accounts visible to this token')
    return { accountId: first.id }
  }

  async listTunnels(accountId: string): Promise<Tunnel[]> {
    return this.request<Tunnel[]>('GET', `/accounts/${accountId}/cfd_tunnel`)
  }

  async createTunnel(accountId: string, name: string, tunnelSecret: string): Promise<Tunnel> {
    return this.request<Tunnel>('POST', `/accounts/${accountId}/cfd_tunnel`, {
      name,
      tunnel_secret: tunnelSecret,
      config_src: 'cloudflare',
    })
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      throw new Error(`cloudflare ${method} ${path}: non-JSON response (HTTP ${res.status})`)
    }
    // Some endpoints (tunnel token) return raw non-enveloped values — detect
    // by the absence of `success` on the parsed body.
    if (!isEnvelope(parsed)) {
      if (!res.ok) throw new Error(`cloudflare ${method} ${path}: HTTP ${res.status}`)
      return parsed as T
    }
    const env = parsed as Envelope<T>
    if (!env.success) {
      const msg = (env.errors ?? []).map((e) => `[${e.code}] ${e.message}`).join('; ')
      throw new Error(msg || `cloudflare ${method} ${path}: HTTP ${res.status}`)
    }
    return env.result as T
  }
}

function isEnvelope(v: unknown): v is Envelope<unknown> {
  return typeof v === 'object' && v !== null && 'success' in (v as Record<string, unknown>)
}
