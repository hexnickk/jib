import { describe, expect, test } from 'bun:test'
import { JibError } from '@jib/core'
import { withBus } from '../../bus-client.ts'

describe('withBus', () => {
  test('wraps connect failure in a helpful JibError', async () => {
    // Point at a port nothing is listening on so Bus.connect fails fast.
    await expect(
      withBus(async () => undefined, { url: 'nats://127.0.0.1:1', name: 'test' }),
    ).rejects.toBeInstanceOf(JibError)
  })
})
