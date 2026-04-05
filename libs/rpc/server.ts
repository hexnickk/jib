import type { Bus } from '@jib/bus'
import { createLogger } from '@jib/core'
import type { z } from 'zod'
import { type Envelope, EnvelopeSchema, SCHEMAS } from './schemas.ts'

type SchemaOf<S extends keyof typeof SCHEMAS> = (typeof SCHEMAS)[S]
type PayloadOf<S extends keyof typeof SCHEMAS> = z.infer<SchemaOf<S>>
type Body<S extends keyof typeof SCHEMAS> = Omit<PayloadOf<S>, keyof Envelope>

const log = createLogger('rpc')

export interface HandleCtx<TProgress extends keyof typeof SCHEMAS | undefined> {
  /** Stamps envelope fields and publishes an intermediate progress event. */
  emitProgress: TProgress extends keyof typeof SCHEMAS ? (body: Body<TProgress>) => void : undefined
  corrId: string
}

export type HandlerResult<
  TSuccess extends keyof typeof SCHEMAS,
  TFailure extends keyof typeof SCHEMAS,
> =
  | { success: { subject: TSuccess; body: Body<TSuccess> } }
  | { failure: { subject: TFailure; body: Body<TFailure> } }

/**
 * Queue-subscribes to a command subject, validates incoming messages, invokes
 * the handler, and publishes the terminal success/failure event the handler
 * returns. Handler exceptions are caught and converted to a generic failure
 * event so the waiting client doesn't hang.
 */
export function handleCmd<
  TCmd extends keyof typeof SCHEMAS,
  TSuccess extends keyof typeof SCHEMAS,
  TFailure extends keyof typeof SCHEMAS,
  TProgress extends keyof typeof SCHEMAS | undefined = undefined,
>(
  bus: Bus,
  cmdSubject: TCmd,
  queue: string,
  source: string,
  progressSubject: TProgress,
  fallbackFailure: TFailure,
  handler: (
    cmd: PayloadOf<TCmd>,
    ctx: HandleCtx<TProgress>,
  ) => Promise<HandlerResult<TSuccess, TFailure>>,
) {
  return bus.queueSubscribe<unknown>(cmdSubject, queue, async (raw) => {
    const parsed = SCHEMAS[cmdSubject].safeParse(raw)
    if (!parsed.success) {
      // Recover corrId + app from the raw payload so the waiting client gets
      // a failure event instead of hanging until its timeout fires.
      const env = EnvelopeSchema.safeParse(raw)
      const msg = `invalid ${cmdSubject}: ${parsed.error.message}`
      log.warn(msg)
      if (env.success) {
        publishFallback(bus, source, env.data.corrId, raw, fallbackFailure, msg)
      }
      return
    }
    const cmd = parsed.data as PayloadOf<TCmd> & Envelope
    const ctx = makeCtx<TProgress>(bus, source, cmd.corrId, progressSubject)
    try {
      const result = await handler(cmd, ctx)
      publishResult(bus, source, cmd.corrId, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      publishFallback(bus, source, cmd.corrId, raw, fallbackFailure, message)
    }
  })
}

/**
 * Emit a best-effort failure event when the handler couldn't produce one
 * (schema fail or thrown exception). Carries over `app` from the raw payload
 * if present, since most failure schemas require it.
 */
function publishFallback<TFailure extends keyof typeof SCHEMAS>(
  bus: Bus,
  source: string,
  corrId: string,
  raw: unknown,
  subject: TFailure,
  error: string,
): void {
  const body: Record<string, unknown> = { error }
  if (
    raw &&
    typeof raw === 'object' &&
    'app' in raw &&
    typeof (raw as { app: unknown }).app === 'string'
  ) {
    body.app = (raw as { app: string }).app
  }
  const payload = { corrId, ts: new Date().toISOString(), source, ...body }
  const parsed = SCHEMAS[subject].safeParse(payload)
  if (parsed.success) bus.publish(subject, parsed.data)
  else log.error(`invalid fallback failure on ${subject}: ${parsed.error.message}`)
}

function makeCtx<TProgress extends keyof typeof SCHEMAS | undefined>(
  bus: Bus,
  source: string,
  corrId: string,
  progressSubject: TProgress,
): HandleCtx<TProgress> {
  if (progressSubject === undefined) {
    return { corrId, emitProgress: undefined } as HandleCtx<TProgress>
  }
  const subj = progressSubject as keyof typeof SCHEMAS
  const emit = (body: Record<string, unknown>) => {
    const payload = { corrId, ts: new Date().toISOString(), source, ...body }
    const parsed = SCHEMAS[subj].safeParse(payload)
    if (parsed.success) bus.publish(subj, parsed.data)
    else log.warn(`invalid progress on ${subj}: ${parsed.error.message}`)
  }
  return { corrId, emitProgress: emit as HandleCtx<TProgress>['emitProgress'] }
}

function publishResult<
  TSuccess extends keyof typeof SCHEMAS,
  TFailure extends keyof typeof SCHEMAS,
>(bus: Bus, source: string, corrId: string, result: HandlerResult<TSuccess, TFailure>): void {
  const { subject, body } =
    'success' in result
      ? { subject: result.success.subject, body: result.success.body }
      : { subject: result.failure.subject, body: result.failure.body }
  const payload = { corrId, ts: new Date().toISOString(), source, ...body }
  const parsed = SCHEMAS[subject].safeParse(payload)
  if (parsed.success) bus.publish(subject, parsed.data)
  else log.error(`invalid terminal event on ${subject}: ${parsed.error.message}`)
}
