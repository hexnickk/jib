import { Bus, DEFAULT_URL } from '@jib/bus'
import { JibError } from '@jib/core'

/**
 * Connect to NATS, run `fn` with the live bus, and always close on exit —
 * including on error. Wraps connect failures with a clear "is jib-bus
 * running?" hint so operators know where to look. Every CLI command that
 * needs the bus goes through here so lifecycle management lives in one
 * place.
 */
export async function withBus<T>(
  fn: (bus: Bus) => Promise<T>,
  opts: { url?: string; name?: string } = {},
): Promise<T> {
  let bus: Bus
  try {
    bus = await Bus.connect(opts.url ?? DEFAULT_URL, {
      name: opts.name ?? 'jib-cli',
      maxAttempts: 3,
    })
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err)
    throw new JibError(
      'bus.connect',
      `cannot connect to NATS — run 'jib init' or check 'systemctl status jib-bus' (${cause})`,
    )
  }
  try {
    return await fn(bus)
  } finally {
    await bus.close().catch(() => {
      /* ignore close errors — we've already done the work */
    })
  }
}
