import type { Bus, Handler } from '@jib/bus'
import type { Subscription } from 'nats'

interface Entry {
  subject: string
  handler: Handler<unknown>
  closed: boolean
}

/**
 * Minimal in-process `Bus`-shaped stub for tests. Delivers JSON-clone copies
 * synchronously via microtasks so assertions don't need fake timers. Only the
 * methods the rpc lib touches are implemented.
 */
export class FakeBus {
  private entries: Entry[] = []

  publish<T>(subject: string, payload: T): void {
    const data = JSON.parse(JSON.stringify(payload)) as unknown
    queueMicrotask(() => {
      for (const e of this.entries) {
        if (e.closed || e.subject !== subject) continue
        void e.handler(data, {} as never)
      }
    })
  }

  subscribe<T>(subject: string, handler: Handler<T>): Subscription {
    return this.attach(subject, handler as Handler<unknown>)
  }

  queueSubscribe<T>(subject: string, _queue: string, handler: Handler<T>): Subscription {
    return this.attach(subject, handler as Handler<unknown>)
  }

  private attach(subject: string, handler: Handler<unknown>): Subscription {
    const entry: Entry = { subject, handler, closed: false }
    this.entries.push(entry)
    return {
      unsubscribe() {
        entry.closed = true
      },
    } as unknown as Subscription
  }

  asBus(): Bus {
    return this as unknown as Bus
  }
}

/** Wait for all pending microtasks/timers to flush. */
export function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}
