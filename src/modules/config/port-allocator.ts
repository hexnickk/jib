import net from 'node:net'
import { PortExhaustedError } from './errors.ts'

/**
 * Minimal structural shape the allocator needs from a parsed jib config.
 * Declared locally so the allocator can live inside `@jib/config` without
 * tying itself to the full parsed config type. Any `Config` from `@jib/config`
 * is structurally assignable.
 */
export interface PortAllocatorConfig {
  apps: Record<string, { domains: ReadonlyArray<{ port?: number | undefined }> }>
}

export interface AllocatePortOpts {
  config: PortAllocatorConfig
  /** Inclusive lower/upper bound of the managed port range. */
  range?: [number, number]
  /**
   * When true, also probe the chosen port via `net.createServer().listen()`
   * on the loopback interface and skip any port that's already bound by a
   * non-jib process. Opt-in because it's async I/O and not every caller
   * needs host-level guarantees.
   */
  probeHost?: boolean
}

const DEFAULT_RANGE: [number, number] = [20000, 29999]

/**
 * Picks the lowest free host port in the managed range for a new app domain.
 *
 * "Free" means: not currently referenced by any `domain.port` in the config
 * (including ports users manually set outside the range - we still respect
 * them) and, if `probeHost` is set, not bound by any host process.
 *
 * Ports outside the managed range are never *handed out*, but they are
 * tracked so the allocator never hands out a duplicate.
 */
export async function configAllocatePort(
  opts: AllocatePortOpts,
): Promise<number | PortExhaustedError> {
  const [lo, hi] = opts.range ?? DEFAULT_RANGE
  const used = configCollectUsedPorts(opts.config)
  for (let port = lo; port <= hi; port++) {
    if (used.has(port)) continue
    if (opts.probeHost && !(await configIsPortFree(port))) continue
    return port
  }
  return new PortExhaustedError(
    `no free port in managed range ${lo}-${hi}: all ${hi - lo + 1} ports in use`,
  )
}

function configCollectUsedPorts(config: PortAllocatorConfig): Set<number> {
  const used = new Set<number>()
  for (const app of Object.values(config.apps)) {
    for (const domain of app.domains) {
      if (typeof domain.port === 'number') used.add(domain.port)
    }
  }
  return used
}

/**
 * Resolves true iff `port` on `host` can be bound right now. Never rejects:
 * any synchronous throw from `server.listen` (e.g. invalid host, EACCES on a
 * privileged port) is caught and treated as "port not free" so the allocator
 * can fall through to the next candidate instead of exploding.
 */
async function configIsPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    try {
      server.listen(port, host)
    } catch {
      resolve(false)
    }
  })
}
