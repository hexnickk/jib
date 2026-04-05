import type { Bus } from '@jib/bus'
import { JibError, ValidationError } from '@jib/core'
import type { z } from 'zod'
import { type Envelope, EnvelopeSchema, SCHEMAS } from './schemas.ts'

type SchemaOf<S extends keyof typeof SCHEMAS> = (typeof SCHEMAS)[S]
type PayloadOf<S extends keyof typeof SCHEMAS> = z.infer<SchemaOf<S>>
/** Command payload without the auto-stamped envelope fields. */
export type Body<S extends keyof typeof SCHEMAS> = Omit<PayloadOf<S>, keyof Envelope>

export interface EmitAndWaitOpts<TProgress> {
  source: string
  timeoutMs: number
  onProgress?: (msg: TProgress) => void
}

/**
 * Publishes a command and blocks until a matching success/failure event
 * arrives (filtered by correlation ID) or the timeout fires. Progress events
 * are streamed to `onProgress` if supplied. On failure, rejects with the
 * event's `error` field surfaced as a `JibError`.
 */
export async function emitAndWait<
  TCmd extends keyof typeof SCHEMAS,
  TSuccess extends keyof typeof SCHEMAS,
  TFailure extends keyof typeof SCHEMAS,
  TProgress extends keyof typeof SCHEMAS | undefined = undefined,
>(
  bus: Bus,
  cmdSubject: TCmd,
  body: Body<TCmd>,
  terminal: { success: TSuccess; failure: TFailure },
  progressSubject: TProgress,
  opts: EmitAndWaitOpts<TProgress extends keyof typeof SCHEMAS ? PayloadOf<TProgress> : never>,
): Promise<PayloadOf<TSuccess>> {
  const corrId = crypto.randomUUID()
  const envelope: Envelope = { corrId, ts: new Date().toISOString(), source: opts.source }
  const cmd = { ...envelope, ...body }

  const parsed = SCHEMAS[cmdSubject].safeParse(cmd)
  if (!parsed.success) {
    throw new ValidationError(`invalid command on ${cmdSubject}: ${parsed.error.message}`)
  }

  return new Promise<PayloadOf<TSuccess>>((resolve, reject) => {
    const subs = [
      bus.subscribe<unknown>(terminal.success, (raw) => {
        const m = parseEvt(terminal.success, raw)
        if (m && m.corrId === corrId) {
          cleanup()
          resolve(m as PayloadOf<TSuccess>)
        }
      }),
      bus.subscribe<unknown>(terminal.failure, (raw) => {
        const m = parseEvt(terminal.failure, raw)
        if (m && m.corrId === corrId) {
          cleanup()
          reject(new JibError('rpc.failure', extractError(m)))
        }
      }),
    ]
    if (progressSubject !== undefined) {
      const psub = progressSubject as keyof typeof SCHEMAS
      subs.push(
        bus.subscribe<unknown>(psub, (raw) => {
          const m = parseEvt(psub, raw)
          if (m && m.corrId === corrId) {
            opts.onProgress?.(m as never)
          }
        }),
      )
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new JibError('rpc.timeout', `${cmdSubject} timed out after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      for (const s of subs) s.unsubscribe()
    }

    bus.publish(cmdSubject, parsed.data)
  })
}

/** Decode an event via its registered schema; returns undefined on mismatch. */
function parseEvt(
  subject: keyof typeof SCHEMAS,
  raw: unknown,
): (Envelope & { [k: string]: unknown }) | undefined {
  const schema = SCHEMAS[subject]
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return undefined
  // Every schema extends EnvelopeSchema so envelope fields exist at runtime.
  const env = EnvelopeSchema.safeParse(parsed.data)
  if (!env.success) return undefined
  return parsed.data as Envelope & { [k: string]: unknown }
}

function extractError(evt: { [k: string]: unknown }): string {
  const e = evt.error
  return typeof e === 'string' && e.length > 0 ? e : 'unknown failure'
}
