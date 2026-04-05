import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { StateError } from '@jib/core'
import { ZodError } from 'zod'
import { type AppState, AppStateSchema, CURRENT_SCHEMA_VERSION, emptyState } from './schema.ts'

/** JSON-backed per-app state store. Writes are atomic via temp file + rename. */
export class Store {
  constructor(private readonly dir: string) {}

  private path(app: string): string {
    return join(this.dir, `${app}.json`)
  }

  async load(app: string): Promise<AppState> {
    const p = this.path(app)
    let raw: string
    try {
      raw = await readFile(p, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyState(app)
      throw new StateError(`reading state ${p}: ${(err as Error).message}`, { cause: err })
    }
    try {
      const parsed = AppStateSchema.parse(JSON.parse(raw))
      if (parsed.schema_version > CURRENT_SCHEMA_VERSION) {
        throw new StateError(
          `state file ${p} has schema_version ${parsed.schema_version}, max supported ${CURRENT_SCHEMA_VERSION}`,
        )
      }
      return parsed
    } catch (err) {
      if (err instanceof StateError) throw err
      if (err instanceof ZodError) {
        throw new StateError(`parsing state ${p}: ${err.message}`, { cause: err })
      }
      throw new StateError(`parsing state ${p}: ${(err as Error).message}`, { cause: err })
    }
  }

  async save(app: string, state: AppState): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o750 })
    const next: AppState = { ...state, schema_version: CURRENT_SCHEMA_VERSION, app }
    const target = this.path(app)
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o640 })
      await rename(tmp, target)
    } catch (err) {
      throw new StateError(`writing state ${target}: ${(err as Error).message}`, { cause: err })
    }
  }

  /**
   * Record a failed deploy attempt in the last-deploy summary. Purely
   * informational — jib has no auto-pinning or retry-counting logic, so
   * nothing reads this field except a human running `cat state/<app>.json`.
   */
  async recordFailure(app: string, errorMsg: string): Promise<void> {
    const st = await this.load(app)
    st.last_deploy_status = 'failure'
    st.last_deploy_error = errorMsg
    st.last_deploy = new Date().toISOString()
    await this.save(app, st)
  }
}
