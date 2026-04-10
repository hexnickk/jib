import { afterEach, describe, expect, test } from 'bun:test'
import net from 'node:net'
import { JibError } from './errors.ts'
import { type PortAllocatorConfig, allocatePort } from './port-allocator.ts'

function cfg(...portsPerApp: number[][]): PortAllocatorConfig {
  const apps: PortAllocatorConfig['apps'] = {}
  portsPerApp.forEach((ports, i) => {
    apps[`app${i}`] = { domains: ports.map((p) => ({ port: p })) }
  })
  return { apps }
}

describe('allocatePort', () => {
  test('empty config returns range start', async () => {
    expect(await allocatePort({ config: { apps: {} } })).toBe(20000)
  })

  test('returns lowest free port in range (gaps)', async () => {
    const config = cfg([20000, 20002])
    expect(await allocatePort({ config })).toBe(20001)
  })

  test('contiguous used ports → first free after them', async () => {
    const config = cfg([20000, 20001, 20002, 20003, 20004, 20005])
    expect(await allocatePort({ config, range: [20000, 20010] })).toBe(20006)
  })

  test('user-specified port outside range is respected but not handed out', async () => {
    const config = cfg([8080])
    const p = await allocatePort({ config })
    expect(p).toBe(20000)
    // And 8080 is still tracked — an in-range request won't collide regardless.
  })

  test('throws port-exhausted when range is fully used', async () => {
    const config = cfg([20000, 20001, 20002])
    let err: unknown
    try {
      await allocatePort({ config, range: [20000, 20002] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(JibError)
    expect((err as JibError).code).toBe('port-exhausted')
  })

  test('honors custom range bounds', async () => {
    const config = cfg([])
    expect(await allocatePort({ config, range: [30000, 30010] })).toBe(30000)
  })

  test('ports across multiple apps are all collected', async () => {
    const config = cfg([20000], [20001, 20002])
    expect(await allocatePort({ config })).toBe(20003)
  })
})

describe('allocatePort probeHost', () => {
  const servers: net.Server[] = []
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((r) => {
            s.close(() => r())
          }),
      ),
    )
  })

  async function grabPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = net.createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address()
        if (addr && typeof addr === 'object') {
          servers.push(s)
          resolve(addr.port)
        } else {
          reject(new Error('no address'))
        }
      })
    })
  }

  test('skips host-bound port and returns next free', async () => {
    const bound = await grabPort()
    const p = await allocatePort({
      config: { apps: {} },
      range: [bound, bound + 1],
      probeHost: true,
    })
    expect(p).toBe(bound + 1)
  })
})
