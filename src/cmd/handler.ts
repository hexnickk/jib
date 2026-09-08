import { cliNormalizeError } from '@jib/cli'
import type { ArgumentsCamelCase } from 'yargs'

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_RE = new RegExp(`${ESC}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g')

/** Writes a single line of text, stripping color when the stream is not a TTY. */
function writeCliText(stream: NodeJS.WriteStream, value: string): void {
  const text = stream.isTTY ? value : value.replaceAll(ANSI_ESCAPE_RE, '')
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

/** Renders a CLI error and exits with the normalized exit code. */
export function cmdExitError(error: unknown): never {
  const normalized = cliNormalizeError(error)
  writeCliText(process.stderr, normalized.message)
  for (const issue of normalized.issues ?? []) {
    writeCliText(process.stderr, `${issue.field}: ${issue.message}`)
  }
  if (normalized.hint) {
    writeCliText(process.stderr, normalized.hint)
  }
  process.exit(normalized.exitCode)
}

/**
 * Wraps a result-returning command implementation in a yargs-compatible handler.
 * Input is a command implementation that may return data, void, or a typed Error. Output is an
 * async yargs handler that exits for returned Errors and otherwise ignores successful payloads.
 */
export function cmdCreateHandler<TArgs>(
  run: (args: ArgumentsCamelCase<TArgs>) => unknown,
): (args: ArgumentsCamelCase<TArgs>) => Promise<void> {
  return async (args) => {
    const result = await run(args)
    // Framework boundary: yargs handlers do not propagate returned typed failures to main.ts.
    if (result instanceof Error) {
      cmdExitError(result)
    }
  }
}
