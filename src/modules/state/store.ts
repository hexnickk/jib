import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InternalError } from '@jib/errors'
import { ZodError } from 'zod'
import { type AppState, AppStateSchema, CURRENT_SCHEMA_VERSION, stateEmpty } from './schema.ts'

export interface StateStore {
  dir: string
}

/** Returns the filesystem-backed store root for app state files. */
export function stateCreateStore(dir: string): StateStore {
  return { dir }
}

function statePath(store: StateStore, app: string): string {
  return join(store.dir, `${app}.json`)
}

/** Loads one app's state file, returning a typed error on read/parse failures. */
export async function stateLoad(store: StateStore, app: string): Promise<AppState | InternalError> {
  const path = statePath(store, app)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return stateEmpty(app)
    }
    return new InternalError(
      `reading state ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  try {
    const parsed = AppStateSchema.parse(JSON.parse(raw))
    if (parsed.schema_version > CURRENT_SCHEMA_VERSION) {
      return new InternalError(
        `state file ${path} has schema_version ${parsed.schema_version}, max supported ${CURRENT_SCHEMA_VERSION}`,
      )
    }
    return parsed
  } catch (error) {
    if (error instanceof ZodError) {
      return new InternalError(`parsing state ${path}: ${error.message}`, { cause: error })
    }
    return new InternalError(
      `parsing state ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** Writes one app's state atomically via a temp file rename. */
export async function stateSave(
  store: StateStore,
  app: string,
  state: AppState,
): Promise<InternalError | undefined> {
  const next: AppState = { ...state, schema_version: CURRENT_SCHEMA_VERSION, app }
  const target = statePath(store, app)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await mkdir(store.dir, { recursive: true, mode: 0o750 })
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o640 })
    await rename(tmp, target)
    return
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    return new InternalError(
      `writing state ${target}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** Removes one app's state file without failing when it is already absent. */
export async function stateRemove(
  store: StateStore,
  app: string,
): Promise<InternalError | undefined> {
  const path = statePath(store, app)
  try {
    await rm(path, { force: true })
    return
  } catch (error) {
    return new InternalError(
      `removing state ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Record a failed deploy attempt in the last-deploy summary. Purely
 * informational — jib has no auto-pinning or retry-counting logic, so
 * nothing reads this field except a human running `cat state/<app>.json`.
 */
export async function stateRecordFailure(
  store: StateStore,
  app: string,
  errorMsg: string,
): Promise<InternalError | undefined> {
  const state = await stateLoad(store, app)
  if (state instanceof Error) {
    return state
  }
  state.last_deploy_status = 'failure'
  state.last_deploy_error = errorMsg
  state.last_deploy = new Date().toISOString()
  return stateSave(store, app, state)
}
