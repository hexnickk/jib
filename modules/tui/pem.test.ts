import { describe, expect, test } from 'bun:test'
import { readPemBlock } from './pem.ts'

function lines(...entries: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) yield entry
    },
  }
}

describe('readPemBlock', () => {
  test('accepts a pasted PEM block after leading blank lines', async () => {
    await expect(
      readPemBlock(lines('', '-----BEGIN PRIVATE KEY-----', 'abc123', '-----END PRIVATE KEY-----')),
    ).resolves.toBe('-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----')
  })

  test('fails fast when the first pasted line is not a PEM header', async () => {
    await expect(readPemBlock(lines('3204750'))).rejects.toThrow(
      'PEM must start with -----BEGIN ...-----',
    )
  })
})
