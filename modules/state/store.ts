import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ZodError } from 'zod'
import { StateError } from './errors.ts'
import { type AppState, AppStateSchema, CURRENT_SCHEMA_VERSION, emptyState } from './schema.ts'

export interface StateStore {
  dir: string
}

export function createStateStore(dir: string): StateStore {
  return { dir }
}

function statePath(store: StateStore, app: string): string {
  return join(store.dir, `${app}.json`)
}

export async function loadState(store: StateStore, app: string): Promise<AppState | StateError> {
  const path = statePath(store, app)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState(app)
    return new StateError(`reading state ${path}: ${(error as Error).message}`, { cause: error })
  }

  try {
    const parsed = AppStateSchema.parse(JSON.parse(raw))
    if (parsed.schema_version > CURRENT_SCHEMA_VERSION) {
      return new StateError(
        `state file ${path} has schema_version ${parsed.schema_version}, max supported ${CURRENT_SCHEMA_VERSION}`,
      )
    }
    return parsed
  } catch (error) {
    if (error instanceof StateError) return error
    if (error instanceof ZodError) {
      return new StateError(`parsing state ${path}: ${error.message}`, { cause: error })
    }
    return new StateError(`parsing state ${path}: ${(error as Error).message}`, { cause: error })
  }
}

export async function saveState(
  store: StateStore,
  app: string,
  state: AppState,
): Promise<StateError | undefined> {
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
    return new StateError(`writing state ${target}: ${(error as Error).message}`, {
      cause: error,
    })
  }
}

export async function removeState(store: StateStore, app: string): Promise<StateError | undefined> {
  const path = statePath(store, app)
  try {
    await rm(path, { force: true })
    return
  } catch (error) {
    return new StateError(`removing state ${path}: ${(error as Error).message}`, { cause: error })
  }
}

/**
 * Record a failed deploy attempt in the last-deploy summary. Purely
 * informational — jib has no auto-pinning or retry-counting logic, so
 * nothing reads this field except a human running `cat state/<app>.json`.
 */
export async function recordStateFailure(
  store: StateStore,
  app: string,
  errorMsg: string,
): Promise<StateError | undefined> {
  const state = await loadState(store, app)
  if (state instanceof StateError) return state
  state.last_deploy_status = 'failure'
  state.last_deploy_error = errorMsg
  state.last_deploy = new Date().toISOString()
  return saveState(store, app, state)
}

/** JSON-backed per-app state store. Compatibility wrapper over the function API. */
export class Store {
  private readonly store: StateStore

  constructor(dir: string) {
    this.store = createStateStore(dir)
  }

  async load(app: string): Promise<AppState> {
    const state = await loadState(this.store, app)
    if (state instanceof StateError) throw state
    return state
  }

  async save(app: string, state: AppState): Promise<void> {
    const error = await saveState(this.store, app, state)
    if (error) throw error
  }

  async remove(app: string): Promise<void> {
    const error = await removeState(this.store, app)
    if (error) throw error
  }

  async recordFailure(app: string, errorMsg: string): Promise<void> {
    const error = await recordStateFailure(this.store, app, errorMsg)
    if (error) throw error
  }
}
