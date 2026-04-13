import { describe, expect, test } from 'bun:test'
import {
  TuiPemInvalidStartError,
  TuiPemMissingBeginError,
  TuiPemMissingEndError,
} from './errors.ts'
import { tuiReadPemBlockResult } from './pem.ts'

function lines(...entries: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) yield entry
    },
  }
}

describe('readPemBlock', () => {
  test('accepts a pasted PEM block after leading blank lines', async () => {
    expect(
      await tuiReadPemBlockResult(
        lines('', '-----BEGIN PRIVATE KEY-----', 'abc123', '-----END PRIVATE KEY-----'),
      ),
    ).toBe('-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----')
  })

  test('returns a typed error when the first pasted line is not a PEM header', async () => {
    const result = await tuiReadPemBlockResult(lines('3204750'))
    expect(result).toBeInstanceOf(TuiPemInvalidStartError)
  })

  test('returns a typed error when no PEM header is provided at all', async () => {
    const result = await tuiReadPemBlockResult(lines('', ''))
    expect(result).toBeInstanceOf(TuiPemMissingBeginError)
  })

  test('returns a typed error when the PEM block has no END marker', async () => {
    const result = await tuiReadPemBlockResult(lines('-----BEGIN PRIVATE KEY-----', 'abc123'))
    expect(result).toBeInstanceOf(TuiPemMissingEndError)
  })
})
