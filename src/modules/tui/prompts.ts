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
type SelectOpts<Value extends string> = {
  message: string
  options: { value: Value; label: string; hint?: string }[]
  initialValue?: Value
}
type ConfirmOpts = { message: string; initialValue?: boolean }

/**
 * Runs `fn` (a thin clack call) under interactive-mode guard and unwraps
 * clack's cancel symbol into a typed error. Every wrapper in this file
 * delegates here so the interactive/cancel/return shape lives in one place.
 */
/** Runs one clack prompt and maps cancellation or library failures to shared result errors. */
async function ask<Value>(
  fn: () => Promise<Value | symbol>,
): Promise<Value | ValidationError | CancelledError | InternalError> {
  const interactiveError = tuiAssertInteractiveResult()
  if (interactiveError) {
    return interactiveError
  }

  let value: Value | symbol
  try {
    value = await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`prompt failed: ${message}`, { cause: error })
  }

  if (clack.isCancel(value)) {
    return new CancelledError('cancelled')
  }
  return value as Value
}

/**
 * Drop `hint: undefined` so clack (compiled under `exactOptionalPropertyTypes`)
 * accepts the literal. Centralized so every select/multiselect call stays typed.
 */
function mapOptions<Value extends string>(
  options: SelectOpts<Value>['options'],
): { value: Value; label: string }[] {
  return options.map((option) =>
    option.hint !== undefined
      ? ({ value: option.value, label: option.label, hint: option.hint } as {
          value: Value
          label: string
        })
      : { value: option.value, label: option.label },
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
      validate: (value: string) => (value.length === 0 ? 'value required' : undefined),
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
  const value = await ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: String(opts.initialValue) }),
      validate: (input: string) => {
        const number = Number(input)
        if (!Number.isInteger(number)) {
          return 'must be an integer'
        }
        if (opts.min !== undefined && number < opts.min) {
          return `must be >= ${opts.min}`
        }
        if (opts.max !== undefined && number > opts.max) {
          return `must be <= ${opts.max}`
        }
        return undefined
      },
    }),
  )
  return value instanceof Error ? value : Number(value)
}

export function tuiPromptPasswordResult(opts: {
  message: string
}): Promise<string | ValidationError | CancelledError | InternalError> {
  return ask(() => clack.password({ message: opts.message }))
}

export function tuiPromptSelectResult<Value extends string>(
  opts: SelectOpts<Value>,
): Promise<Value | ValidationError | CancelledError | InternalError> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.select<Value>>[0]['options']
  return ask<Value>(() =>
    clack.select<Value>({
      message: opts.message,
      options,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export function tuiPromptMultiSelectResult<Value extends string>(
  opts: SelectOpts<Value>,
): Promise<Value[] | ValidationError | CancelledError | InternalError> {
  const options = mapOptions(opts.options) as Parameters<
    typeof clack.multiselect<Value>
  >[0]['options']
  return ask<Value[]>(() =>
    clack.multiselect<Value>({ message: opts.message, options, required: false }),
  )
}

/**
 * Read a PEM block from stdin. Collects lines until one matches
 * `-----END ... KEY-----`, then returns the full block. Uses raw
 * readline so pasted multiline text works because clack has no multiline input.
 */
export async function tuiPromptPemResult(opts: {
  message: string
}): Promise<string | ValidationError | CancelledError | InternalError> {
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
