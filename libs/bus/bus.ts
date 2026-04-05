import { JibError, type Logger, createLogger } from '@jib/core'
import {
  type Msg,
  type NatsConnection,
  type Subscription,
  type SubscriptionOptions,
  connect as natsConnect,
} from 'nats'
import { jsonCodec } from './codec.ts'

/** Default NATS address, matches the Go implementation. */
export const DEFAULT_URL = 'nats://localhost:4222'

export interface ConnectOptions {
  /** Client name advertised to the server. Defaults to `jib`. */
  name?: string
  /** Max connect attempts before throwing. Defaults to 10. */
  maxAttempts?: number
  /** Override the logger (defaults to a `bus`-tagged consola child). */
  logger?: Logger
}

export type Handler<T> = (msg: T, raw: Msg) => void | Promise<void>

/** Thin wrapper around `NatsConnection` with typed JSON pub/sub/request. */
export class Bus {
  /**
   * Internal: construct directly from an existing connection. Kept non-private
   * so tests can pass in an in-memory fake. Production code should use
   * {@link Bus.connect}.
   */
  constructor(
    private readonly conn: NatsConnection,
    private readonly log: Logger = createLogger('bus'),
  ) {}

  /** Connect with exponential backoff (1s, 2s, 4s, …, cap 30s). */
  static async connect(url = DEFAULT_URL, opts: ConnectOptions = {}): Promise<Bus> {
    const log = opts.logger ?? createLogger('bus')
    const max = opts.maxAttempts ?? 10
    let delayMs = 1000
    let lastErr: unknown
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const conn = await natsConnect({ servers: url, name: opts.name ?? 'jib' })
        log.info(`connected to ${url}`)
        return new Bus(conn, log)
      } catch (err) {
        lastErr = err
        log.warn(`connect attempt ${attempt}/${max} failed: ${describe(err)}`)
        if (attempt === max) break
        await sleep(delayMs)
        delayMs = Math.min(delayMs * 2, 30_000)
      }
    }
    throw new JibError('bus.connect', `failed to connect to NATS at ${url}: ${describe(lastErr)}`)
  }

  /** Drain in-flight messages then close the connection. */
  async close(): Promise<void> {
    await this.conn.drain()
  }

  /** Escape hatch for advanced nats features (JetStream, etc). */
  raw(): NatsConnection {
    return this.conn
  }

  publish<T>(subject: string, payload: T): void {
    this.conn.publish(subject, jsonCodec<T>().encode(payload))
  }

  subscribe<T>(subject: string, handler: Handler<T>, opts?: SubscriptionOptions): Subscription {
    return this.attach(this.conn.subscribe(subject, opts), subject, handler)
  }

  queueSubscribe<T>(
    subject: string,
    queue: string,
    handler: Handler<T>,
    opts?: Omit<SubscriptionOptions, 'queue'>,
  ): Subscription {
    return this.attach(this.conn.subscribe(subject, { ...opts, queue }), subject, handler)
  }

  async request<TReq, TRes>(subject: string, payload: TReq, timeoutMs: number): Promise<TRes> {
    const reply = await this.conn.request(subject, jsonCodec<TReq>().encode(payload), {
      timeout: timeoutMs,
    })
    return jsonCodec<TRes>().decode(reply.data)
  }

  /** Wire up a subscription to decode JSON and swallow handler errors. */
  private attach<T>(sub: Subscription, subject: string, handler: Handler<T>): Subscription {
    const codec = jsonCodec<T>()
    void (async () => {
      for await (const raw of sub) {
        try {
          await handler(codec.decode(raw.data), raw)
        } catch (err) {
          this.log.error(`handler error on ${subject}: ${describe(err)}`)
        }
      }
    })()
    return sub
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
