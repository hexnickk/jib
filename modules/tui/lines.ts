import { createInterface } from 'node:readline'
import * as clack from '@clack/prompts'
import { TuiPromptCancelledError, TuiPromptTooManyLinesError } from './errors.ts'
import type { TuiNotInteractiveError } from './errors.ts'
import { tuiAssertInteractiveResult } from './interactive.ts'

type TuiAskError = TuiNotInteractiveError | TuiPromptCancelledError

type LinesOpts = {
  title: string
  lines: string[]
  promptLabel?: string
  validateLine?: (line: string) => string | undefined
  maxLines?: number
}

async function readLine(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string | TuiPromptCancelledError> {
  return await new Promise<string>((resolve) => {
    const onSigInt = () => {
      rl.removeListener('SIGINT', onSigInt)
      resolve(new TuiPromptCancelledError() as unknown as string)
    }
    rl.once('SIGINT', onSigInt)
    rl.question(prompt, (answer) => {
      rl.removeListener('SIGINT', onSigInt)
      resolve(answer)
    })
  })
}

/** Reads multiple input lines until blank input or the configured limit. */
export async function tuiPromptLinesResult(
  opts: LinesOpts,
): Promise<string[] | TuiAskError | TuiPromptTooManyLinesError> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) return interactiveError
  const maxLines = opts.maxLines ?? 100
  clack.note(opts.lines.join('\n'), opts.title)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const out: string[] = []
  try {
    while (out.length < maxLines) {
      const answer = await readLine(rl, `${opts.promptLabel ?? 'entry'} ${out.length + 1}> `)
      if (answer instanceof TuiPromptCancelledError) return answer
      const line = answer.trim()
      if (line.length === 0) return out
      const error = opts.validateLine?.(line)
      if (error) {
        clack.log.warning(error)
        continue
      }
      out.push(line)
    }
  } finally {
    rl.close()
  }
  return new TuiPromptTooManyLinesError(maxLines)
}
