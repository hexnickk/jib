import { InternalError, ValidationError } from '@jib/errors'

function isBoundary(line: string, kind: 'BEGIN' | 'END'): boolean {
  return line.startsWith(`-----${kind} `) && line.endsWith('-----')
}

/**
 * Reads a PEM block from an async line source and returns validation errors for
 * malformed input or an internal error when the source fails.
 */
export async function tuiReadPemBlockResult(
  lines: AsyncIterable<string>,
  maxLines = 200,
): Promise<string | ValidationError | InternalError> {
  const out: string[] = []

  try {
    for await (const line of lines) {
      if (out.length === 0) {
        if (line.trim().length === 0) {
          continue
        }
        if (!isBoundary(line, 'BEGIN')) {
          return new ValidationError('PEM must start with -----BEGIN ...-----')
        }
      }

      out.push(line)
      if (isBoundary(line, 'END')) {
        break
      }
      if (out.length >= maxLines) {
        break
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`reading PEM input: ${message}`, { cause: error })
  }

  if (out.length === 0) {
    return new ValidationError('invalid PEM: missing BEGIN marker')
  }
  if (!out.some((line) => isBoundary(line, 'END'))) {
    return new ValidationError('invalid PEM: missing END marker')
  }
  return out.join('\n')
}
