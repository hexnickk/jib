import { ValidationError } from '@jib/core'

function isBoundary(line: string, kind: 'BEGIN' | 'END'): boolean {
  return line.startsWith(`-----${kind} `) && line.endsWith('-----')
}

export async function readPemBlock(lines: AsyncIterable<string>, maxLines = 200): Promise<string> {
  const out: string[] = []

  for await (const line of lines) {
    if (out.length === 0) {
      if (line.trim().length === 0) continue
      if (!isBoundary(line, 'BEGIN')) {
        throw new ValidationError('PEM must start with -----BEGIN ...-----')
      }
    }

    out.push(line)
    if (isBoundary(line, 'END')) break
    if (out.length >= maxLines) break
  }

  if (out.length === 0) throw new ValidationError('invalid PEM: missing BEGIN marker')
  if (!out.some((line) => isBoundary(line, 'END'))) {
    throw new ValidationError('invalid PEM: missing END marker')
  }
  return out.join('\n')
}
