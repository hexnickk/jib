import { describe, expect, test } from 'bun:test'
import type { Logger } from '@jib/core'
import type { Msg, NatsConnection, Subscription } from 'nats'
import { Bus } from './bus.ts'
import { jsonCodec } from './codec.ts'

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
} as unknown as Logger

/**
 * In-memory NatsConnection stub — implements only the surface the Bus
 * wrapper touches (publish, subscribe, drain, request). Subscriptions expose
 * themselves as async iterators so the wrapper's `for await` loop works.
 */
interface StubSub {
  subject: string
  queue?: string
  push(msg: Msg): void
}

class FakeNats {
  subs: StubSub[] = []

  publish(subject: string, data: Uint8Array): void {
    const msg: Msg = {
      subject,
      sid: 0,
      data,
      reply: '',
      headers: undefined,
      respond: () => false,
      json: <T>() => JSON.parse(new TextDecoder().decode(data)) as T,
      string: () => new TextDecoder().decode(data),
    } as unknown as Msg
    for (const s of this.subs) {
      if (s.subject === subject || s.subject === '*' || s.subject === '>') s.push(msg)
    }
  }

  subscribe(subject: string, opts?: { queue?: string }): Subscription {
    const queue: Msg[] = []
    let resolver: ((v: IteratorResult<Msg>) => void) | null = null
    let closed = false
    const sub: StubSub & Subscription = {
      subject,
      queue: opts?.queue,
      push(msg: Msg) {
        if (resolver) {
          const r = resolver
          resolver = null
          r({ value: msg, done: false })
        } else {
          queue.push(msg)
        }
      },
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Msg>> {
            if (closed) return Promise.resolve({ value: undefined, done: true })
            const next = queue.shift()
            if (next) return Promise.resolve({ value: next, done: false })
            return new Promise((r) => {
              resolver = r
            })
          },
        }
      },
      unsubscribe() {
        closed = true
        if (resolver) resolver({ value: undefined, done: true })
      },
      drain: async () => {
        closed = true
        if (resolver) resolver({ value: undefined, done: true })
      },
    } as unknown as StubSub & Subscription
    this.subs.push(sub)
    return sub
  }

  async drain(): Promise<void> {
    for (const s of this.subs) (s as unknown as { unsubscribe(): void }).unsubscribe()
  }
}

function newBus(): { bus: Bus; nats: FakeNats } {
  const nats = new FakeNats()
  const bus = new Bus(nats as unknown as NatsConnection, silentLogger)
  return { bus, nats }
}

async function nextTick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('Bus', () => {
  test('publish encodes JSON and subscribe decodes it', async () => {
    const { bus } = newBus()
    const received: Array<{ v: number }> = []
    bus.subscribe<{ v: number }>('foo', (msg) => {
      received.push(msg)
    })
    bus.publish('foo', { v: 42 })
    await nextTick()
    expect(received).toEqual([{ v: 42 }])
  })

  test('subject routing only delivers matching subscribers', async () => {
    const { bus } = newBus()
    const a: unknown[] = []
    const b: unknown[] = []
    bus.subscribe<unknown>('a', (m) => {
      a.push(m)
    })
    bus.subscribe<unknown>('b', (m) => {
      b.push(m)
    })
    bus.publish('a', { who: 'a' })
    await nextTick()
    expect(a).toEqual([{ who: 'a' }])
    expect(b).toEqual([])
  })

  test('handler errors are caught and do not kill the subscription', async () => {
    const { bus } = newBus()
    let calls = 0
    bus.subscribe<{ n: number }>('x', (m) => {
      calls++
      if (m.n === 1) throw new Error('boom')
    })
    bus.publish('x', { n: 1 })
    bus.publish('x', { n: 2 })
    await nextTick()
    await nextTick()
    expect(calls).toBe(2)
  })

  test('queueSubscribe records queue group on the underlying subscription', async () => {
    const { bus, nats } = newBus()
    bus.queueSubscribe<{ v: number }>('work', 'workers', () => {})
    expect(nats.subs[0]?.queue).toBe('workers')
  })

  test('jsonCodec round-trips through the wire bytes', () => {
    const codec = jsonCodec<{ a: string }>()
    const bytes = codec.encode({ a: 'hi' })
    expect(codec.decode(bytes)).toEqual({ a: 'hi' })
  })
})

test.skipIf(!process.env.NATS_TEST_URL)('integration: real server round-trip', async () => {
  const url = process.env.NATS_TEST_URL as string
  const bus = await Bus.connect(url, { maxAttempts: 1 })
  try {
    const got: Array<{ n: number }> = []
    bus.subscribe<{ n: number }>('jib.test.roundtrip', (m) => {
      got.push(m)
    })
    bus.publish('jib.test.roundtrip', { n: 1 })
    await new Promise((r) => setTimeout(r, 50))
    expect(got).toEqual([{ n: 1 }])
  } finally {
    await bus.close()
  }
})
