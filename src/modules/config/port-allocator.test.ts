import { afterEach, describe, expect, test } from 'bun:test'
import net from 'node:net'
import { PortExhaustedError } from './errors.ts'
import { type PortAllocatorConfig, configAllocatePort } from './port-allocator.ts'

function cfg(...portsPerApp: number[][]): PortAllocatorConfig {
  const apps: PortAllocatorConfig['apps'] = {}
  portsPerApp.forEach((ports, i) => {
    apps[`app${i}`] = { domains: ports.map((port) => ({ port })) }
  })
  return { apps }
}

describe('configAllocatePort', () => {
  test('empty config returns range start', async () => {
    expect(await configAllocatePort({ config: { apps: {} } })).toBe(20000)
  })

  test('returns lowest free port in range (gaps)', async () => {
    const config = cfg([20000, 20002])
    expect(await configAllocatePort({ config })).toBe(20001)
  })

  test('contiguous used ports -> first free after them', async () => {
    const config = cfg([20000, 20001, 20002, 20003, 20004, 20005])
    expect(await configAllocatePort({ config, range: [20000, 20010] })).toBe(20006)
  })

  test('user-specified port outside range is respected but not handed out', async () => {
    const config = cfg([8080])
    const port = await configAllocatePort({ config })
    expect(port).toBe(20000)
  })

  test('configAllocatePort returns PortExhaustedError when range is fully used', async () => {
    const config = cfg([20000, 20001, 20002])
    expect(await configAllocatePort({ config, range: [20000, 20002] })).toBeInstanceOf(
      PortExhaustedError,
    )
  })

  test('honors custom range bounds', async () => {
    const config = cfg([])
    expect(await configAllocatePort({ config, range: [30000, 30010] })).toBe(30000)
  })

  test('ports across multiple apps are all collected', async () => {
    const config = cfg([20000], [20001, 20002])
    expect(await configAllocatePort({ config })).toBe(20003)
  })
})

describe('configAllocatePort probeHost', () => {
  const servers: net.Server[] = []
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          }),
      ),
    )
  })

  async function grabPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          servers.push(server)
          resolve(addr.port)
        } else {
          reject(new Error('no address'))
        }
      })
    })
  }

  test('skips host-bound port and returns next free', async () => {
    const bound = await grabPort()
    const port = await configAllocatePort({
      config: { apps: {} },
      range: [bound, bound + 1],
      probeHost: true,
    })
    expect(port).toBe(bound + 1)
  })
})
