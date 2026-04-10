import { JSONCodec } from 'nats'

/**
 * Thin generic wrapper over nats `JSONCodec`. The nats type is `Codec<unknown>`
 * by default; we re-type it per message so callers get structural checks at
 * the call site without sprinkling `as` everywhere.
 */
export interface JsonCodec<T> {
  encode(payload: T): Uint8Array
  decode(data: Uint8Array): T
}

const base = JSONCodec()

export function jsonCodec<T>(): JsonCodec<T> {
  return {
    encode: (payload) => base.encode(payload),
    decode: (data) => base.decode(data) as T,
  }
}
