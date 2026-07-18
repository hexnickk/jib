import { createInterface } from 'node:readline'
import * as clack from '@clack/prompts'
import { CancelledError, InternalError, type ValidationError } from '@jib/errors'
import { tuiAssertInteractiveResult } from './interactive.ts'
import { tuiReadPemBlockResult } from './pem.ts'

export {
  intro as tuiIntro,
  log as tuiLog,
  note as tuiNote,
  outro as tuiOutro,
  spinner as tuiSpinner,
} from '@clack/prompts'

type StrOpts = { message: string; placeholder?: string; initialValue?: string }
type IntOpts = { message: string; initialValue?: number; min?: number; max?: number }
type SelectOpts<T extends string> = {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}
type ConfirmOpts = { message: string; initialValue?: boolean }

/**
 * Runs `fn` (a thin clack call) under interactive-mode guard and unwraps
 * clack's cancel symbol into a typed error. Every wrapper in this file
 * delegates here so the interactive/cancel/return shape lives in one place.
 */
/** Runs one clack prompt and maps cancellation or library failures to shared result errors. */
async function ask<T>(
  fn: () => Promise<T | symbol>,
): Promise<T | ValidationError | CancelledError | InternalError> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) {
    return interactiveError
  }

  let value: T | symbol
  try {
    value = await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`prompt failed: ${message}`, { cause: error })
  }

  if (clack.isCancel(value)) {
    return new CancelledError('cancelled')
  }
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

export function tuiPromptStringResult(
  opts: StrOpts,
): Promise<string | ValidationError | CancelledError | InternalError> {
  return ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
      validate: (v: string) => (v.length === 0 ? 'value required' : undefined),
    }),
  )
}

export async function tuiPromptStringOptionalResult(
  opts: StrOpts,
): Promise<string | ValidationError | CancelledError | InternalError> {
  const result = await ask<string | undefined>(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
  return result instanceof Error ? result : (result ?? '')
}

export async function tuiPromptIntResult(
  opts: IntOpts,
): Promise<number | ValidationError | CancelledError | InternalError> {
  const v = await ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: String(opts.initialValue) }),
      validate: (s: string) => {
        const n = Number(s)
        if (!Number.isInteger(n)) {
          return 'must be an integer'
        }
        if (opts.min !== undefined && n < opts.min) {
          return `must be >= ${opts.min}`
        }
        if (opts.max !== undefined && n > opts.max) {
          return `must be <= ${opts.max}`
        }
        return undefined
      },
    }),
  )
  return v instanceof Error ? v : Number(v)
}

export function tuiPromptPasswordResult(opts: { message: string }): Promise<
  string | ValidationError | CancelledError | InternalError
> {
  return ask(() => clack.password({ message: opts.message }))
}

export function tuiPromptSelectResult<T extends string>(
  opts: SelectOpts<T>,
): Promise<T | ValidationError | CancelledError | InternalError> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.select<T>>[0]['options']
  return ask<T>(() =>
    clack.select<T>({
      message: opts.message,
      options,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export function tuiPromptMultiSelectResult<T extends string>(
  opts: SelectOpts<T>,
): Promise<T[] | ValidationError | CancelledError | InternalError> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.multiselect<T>>[0]['options']
  return ask<T[]>(() => clack.multiselect<T>({ message: opts.message, options, required: false }))
}

/**
 * Read a PEM block from stdin. Collects lines until one matches
 * `-----END ... KEY-----`, then returns the full block. Uses raw
 * readline so pasted multiline text works because clack has no multiline input.
 */
export async function tuiPromptPemResult(opts: { message: string }): Promise<
  string | ValidationError | CancelledError | InternalError
> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) {
    return interactiveError
  }

  while (true) {
    try {
      clack.log.info(`${opts.message} (paste full PEM block)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`rendering prompt: ${message}`, { cause: error })
    }

    let pem: Awaited<ReturnType<typeof tuiReadPemBlockResult>>
    let rl: ReturnType<typeof createInterface> | undefined
    try {
      rl = createInterface({ input: process.stdin })
      pem = await tuiReadPemBlockResult(rl)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`reading PEM input: ${message}`, { cause: error })
    } finally {
      rl?.close()
    }

    if (typeof pem === 'string') {
      return pem
    }
    if (pem instanceof InternalError) {
      return pem
    }

    try {
      clack.log.warning(pem.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`rendering prompt: ${message}`, { cause: error })
    }

    const retry = await tuiPromptConfirmResult({
      message: 'Try pasting the PEM again?',
      initialValue: true,
    })
    if (retry instanceof Error) {
      return retry
    }
    if (!retry) {
      return pem
    }
  }
}

export function tuiPromptConfirmResult(
  opts: ConfirmOpts,
): Promise<boolean | ValidationError | CancelledError | InternalError> {
  return ask(() =>
    clack.confirm({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}
