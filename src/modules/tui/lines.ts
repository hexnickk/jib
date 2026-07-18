import { createInterface } from 'node:readline'
import * as clack from '@clack/prompts'
import { CancelledError, InternalError, ValidationError } from '@jib/errors'
import { tuiAssertInteractiveResult } from './interactive.ts'

type LinesOpts = {
  title: string
  lines: string[]
  promptLabel?: string
  validateLine?: (line: string) => string | undefined
  maxLines?: number
}

/** Reads one line and maps cancellation or terminal failures to shared result errors. */
async function readLine(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string | CancelledError | InternalError> {
  return await new Promise<string | CancelledError | InternalError>((resolve) => {
    let settled = false

    function done(result: string | CancelledError | InternalError): void {
      if (settled) {
        return
      }
      settled = true
      rl.removeListener('SIGINT', onSigInt)
      rl.removeListener('error', onError)
      resolve(result)
    }

    function onSigInt(): void {
      done(new CancelledError('cancelled'))
    }

    function onError(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error)
      done(new InternalError(`reading input: ${message}`, { cause: error }))
    }

    rl.once('SIGINT', onSigInt)
    rl.once('error', onError)
    try {
      rl.question(prompt, (answer) => {
        done(answer)
      })
    } catch (error) {
      onError(error)
    }
  })
}

/** Reads multiple input lines until blank input or the configured limit. */
export async function tuiPromptLinesResult(
  opts: LinesOpts,
): Promise<string[] | ValidationError | CancelledError | InternalError> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) {
    return interactiveError
  }

  const maxLines = opts.maxLines ?? 100
  try {
    clack.note(opts.lines.join('\n'), opts.title)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`rendering prompt: ${message}`, { cause: error })
  }

  let rl: ReturnType<typeof createInterface>
  try {
    rl = createInterface({ input: process.stdin, output: process.stdout })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`opening input: ${message}`, { cause: error })
  }

  const out: string[] = []
  try {
    while (out.length < maxLines) {
      const answer = await readLine(rl, `${opts.promptLabel ?? 'entry'} ${out.length + 1}> `)
      if (answer instanceof Error) {
        return answer
      }

      const line = answer.trim()
      if (line.length === 0) {
        return out
      }

      let validationMessage: string | undefined
      try {
        validationMessage = opts.validateLine?.(line)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return new InternalError(`validating input: ${message}`, { cause: error })
      }
      if (validationMessage) {
        try {
          clack.log.warning(validationMessage)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return new InternalError(`rendering prompt: ${message}`, { cause: error })
        }
        continue
      }
      out.push(line)
    }
  } finally {
    rl.close()
  }
  return new ValidationError(`too many lines (max ${maxLines})`)
}
