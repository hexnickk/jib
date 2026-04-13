import { createInterface } from 'node:readline'
import * as clack from '@clack/prompts'
import { TuiPromptCancelledError, TuiPromptTooManyLinesError, isTuiPemReadError } from './errors.ts'
import { tuiAssertInteractiveResult } from './interactive.ts'
import { tuiReadPemBlockResult } from './pem.ts'

export { intro, outro, spinner, log, note } from '@clack/prompts'

type StrOpts = { message: string; placeholder?: string; initialValue?: string }
type IntOpts = { message: string; initialValue?: number; min?: number; max?: number }
type SelectOpts<T extends string> = {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}
type ConfirmOpts = { message: string; initialValue?: boolean }
type LinesOpts = {
  title: string
  lines: string[]
  promptLabel?: string
  validateLine?: (line: string) => string | undefined
  maxLines?: number
}

/**
 * Runs `fn` (a thin clack call) under interactive-mode guard and unwraps
 * clack's cancel symbol into a typed error. Every wrapper in this file
 * delegates here so the interactive/cancel/return shape lives in one place.
 */
async function ask<T>(fn: () => Promise<T | symbol>): Promise<T> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) throw interactiveError
  const value = await fn()
  if (clack.isCancel(value)) throw new TuiPromptCancelledError()
  return value as T
}

/**
 * Drop `hint: undefined` so clack (compiled under `exactOptionalPropertyTypes`)
 * accepts the literal. Centralized so every select/multiselect call stays typed.
 */
function mapOptions<T extends string>(
  options: SelectOpts<T>['options'],
): { value: T; label: string }[] {
  return options.map((o) =>
    o.hint !== undefined
      ? ({ value: o.value, label: o.label, hint: o.hint } as { value: T; label: string })
      : { value: o.value, label: o.label },
  )
}

export function tuiPromptString(opts: StrOpts): Promise<string> {
  return ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
      validate: (v: string) => (v.length === 0 ? 'value required' : undefined),
    }),
  )
}

export function tuiPromptStringOptional(opts: StrOpts): Promise<string> {
  return ask<string | undefined>(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  ).then((value) => value ?? '')
}

async function readLine(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const onSigInt = () => {
      rl.removeListener('SIGINT', onSigInt)
      reject(new TuiPromptCancelledError())
    }
    rl.once('SIGINT', onSigInt)
    rl.question(prompt, (answer) => {
      rl.removeListener('SIGINT', onSigInt)
      resolve(answer)
    })
  })
}

export async function tuiPromptLines(opts: LinesOpts): Promise<string[]> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) throw interactiveError
  const maxLines = opts.maxLines ?? 100
  clack.note(opts.lines.join('\n'), opts.title)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const out: string[] = []
  try {
    while (out.length < maxLines) {
      const line = (await readLine(rl, `${opts.promptLabel ?? 'entry'} ${out.length + 1}> `)).trim()
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
  throw new TuiPromptTooManyLinesError(maxLines)
}

export async function tuiPromptInt(opts: IntOpts): Promise<number> {
  const v = await ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: String(opts.initialValue) }),
      validate: (s: string) => {
        const n = Number(s)
        if (!Number.isInteger(n)) return 'must be an integer'
        if (opts.min !== undefined && n < opts.min) return `must be >= ${opts.min}`
        if (opts.max !== undefined && n > opts.max) return `must be <= ${opts.max}`
        return undefined
      },
    }),
  )
  return Number(v)
}

export function tuiPromptPassword(opts: { message: string }): Promise<string> {
  return ask(() => clack.password({ message: opts.message }))
}

export function tuiPromptSelect<T extends string>(opts: SelectOpts<T>): Promise<T> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.select<T>>[0]['options']
  return ask<T>(() =>
    clack.select<T>({
      message: opts.message,
      options,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export function tuiPromptMultiSelect<T extends string>(opts: SelectOpts<T>): Promise<T[]> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.multiselect<T>>[0]['options']
  return ask<T[]>(() => clack.multiselect<T>({ message: opts.message, options, required: false }))
}

/**
 * Read a PEM block from stdin. Collects lines until one matches
 * `-----END ... KEY-----`, then returns the full block. Uses raw
 * readline so pasted multiline text works because clack has no multiline input.
 */
export async function tuiPromptPEM(opts: { message: string }): Promise<string> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) throw interactiveError
  while (true) {
    clack.log.info(`${opts.message} (paste full PEM block)`)
    const rl = createInterface({ input: process.stdin })
    let pem: Awaited<ReturnType<typeof tuiReadPemBlockResult>>
    try {
      pem = await tuiReadPemBlockResult(rl)
    } finally {
      rl.close()
    }

    if (!(pem instanceof Error)) return pem
    if (!isTuiPemReadError(pem)) throw pem
    clack.log.warning(pem.message)
    const retry = await tuiPromptConfirm({
      message: 'Try pasting the PEM again?',
      initialValue: true,
    })
    if (!retry) throw pem
  }
}

export function tuiPromptConfirm(opts: ConfirmOpts): Promise<boolean> {
  return ask(() =>
    clack.confirm({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export {
  tuiPromptConfirm as promptConfirm,
  tuiPromptInt as promptInt,
  tuiPromptLines as promptLines,
  tuiPromptMultiSelect as promptMultiSelect,
  tuiPromptPEM as promptPEM,
  tuiPromptPassword as promptPassword,
  tuiPromptSelect as promptSelect,
  tuiPromptString as promptString,
  tuiPromptStringOptional as promptStringOptional,
}
