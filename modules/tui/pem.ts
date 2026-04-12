import {
  TuiPemInvalidStartError,
  TuiPemMissingBeginError,
  TuiPemMissingEndError,
} from './errors.ts'

function isBoundary(line: string, kind: 'BEGIN' | 'END'): boolean {
  return line.startsWith(`-----${kind} `) && line.endsWith('-----')
}

export type ReadPemBlockError =
  | TuiPemInvalidStartError
  | TuiPemMissingBeginError
  | TuiPemMissingEndError

export async function readPemBlockResult(
  lines: AsyncIterable<string>,
  maxLines = 200,
): Promise<ReadPemBlockError | string> {
  const out: string[] = []

  for await (const line of lines) {
    if (out.length === 0) {
      if (line.trim().length === 0) continue
      if (!isBoundary(line, 'BEGIN')) return new TuiPemInvalidStartError()
    }

    out.push(line)
    if (isBoundary(line, 'END')) break
    if (out.length >= maxLines) break
  }

  if (out.length === 0) return new TuiPemMissingBeginError()
  if (!out.some((line) => isBoundary(line, 'END'))) return new TuiPemMissingEndError()
  return out.join('\n')
}

export async function readPemBlock(lines: AsyncIterable<string>, maxLines = 200): Promise<string> {
  const result = await readPemBlockResult(lines, maxLines)
  if (result instanceof Error) throw result
  return result
}
