import { cliNormalizeError } from '@jib/cli'
import type { ArgumentsCamelCase } from 'yargs'

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_RE = new RegExp(`${ESC}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g')

/** Removes ANSI escape sequences before writing to a non-TTY stream. */
function stripAnsiText(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_RE, '')
}

/** Writes a single line of text, stripping color when the stream is not a TTY. */
function writeCliText(stream: NodeJS.WriteStream, value: string): void {
  const text = stream.isTTY ? value : stripAnsiText(value)
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

/** Renders a normalized CLI error in text mode. */
function writeCliTextError(error: ReturnType<typeof cliNormalizeError>): void {
  writeCliText(process.stderr, error.message)
  for (const issue of error.issues ?? []) {
    writeCliText(process.stderr, `${issue.field}: ${issue.message}`)
  }
  if (error.hint) writeCliText(process.stderr, error.hint)
}

/** Renders a CLI error and exits with the normalized exit code. */
export function cmdExitError(error: unknown): never {
  const normalized = cliNormalizeError(error)
  writeCliTextError(normalized)
  process.exit(normalized.exitCode)
}

/**
 * Completes a yargs handler from a command implementation result.
 * Input is any value returned by a command run function; non-error values are ignored because
 * the text CLI currently renders output inside command implementations. Side effect: exits the
 * process for returned Error instances so yargs does not convert typed failures into raw stacks.
 */
function cmdHandleResult(result: unknown): void {
  // Framework boundary: yargs handlers do not propagate returned typed failures to main.ts.
  if (result instanceof Error) cmdExitError(result)
}

/**
 * Wraps a result-returning command implementation in a yargs-compatible handler.
 * Input is a command implementation that may return data, void, or a typed Error. Output is an
 * async yargs handler that exits for returned Errors and otherwise ignores successful payloads.
 */
export function cmdCreateHandler<TArgs>(
  run: (args: ArgumentsCamelCase<TArgs>) => Promise<unknown> | unknown,
): (args: ArgumentsCamelCase<TArgs>) => Promise<void> {
  return async (args) => {
    cmdHandleResult(await run(args))
  }
}
