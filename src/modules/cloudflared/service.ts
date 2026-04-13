import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { type Paths, pathsCredsPath, pathsEnsureCredsDirResult } from '@jib/paths'
import { CloudflaredSaveTunnelTokenError } from './errors.ts'
import { CLOUDFLARED_SERVICE_NAME } from './templates.ts'
import { cloudflaredExtractTunnelToken } from './token.ts'

interface ShellCommandResultLike {
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

interface CloudflaredEnableServiceDeps {
  run?: () => Promise<ShellCommandResultLike>
}

export interface CloudflaredEnableServiceResult {
  detail: string
  ok: boolean
}

/** Returns the env-file path that stores the tunnel token for cloudflared. */
export function cloudflaredTunnelTokenPath(paths: Paths): string {
  return pathsCredsPath(paths, 'cloudflare', 'tunnel.env')
}

/** Reports whether a non-empty tunnel token has already been saved. */
export function cloudflaredHasTunnelToken(paths: Paths): boolean {
  const path = cloudflaredTunnelTokenPath(paths)
  return existsSync(path) && readFileSync(path, 'utf8').trim().length > 0
}

/** Persists the normalized tunnel token, or returns a typed write error. */
export async function cloudflaredSaveTunnelToken(
  paths: Paths,
  raw: string,
): Promise<boolean | CloudflaredSaveTunnelTokenError> {
  const token = cloudflaredExtractTunnelToken(raw)
  if (!token) return false

  try {
    const path = cloudflaredTunnelTokenPath(paths)
    const ensured = await pathsEnsureCredsDirResult(paths, 'cloudflare')
    if (ensured instanceof Error) {
      return new CloudflaredSaveTunnelTokenError(`write tunnel token: ${ensured.message}`, {
        cause: ensured,
      })
    }
    await writeFile(path, `TUNNEL_TOKEN=${token}\n`, { mode: 0o640 })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new CloudflaredSaveTunnelTokenError(`write tunnel token: ${message}`, {
      cause: error,
    })
  }
}

/** Enables and starts the systemd unit without surfacing runner exceptions. */
export async function cloudflaredEnableService(
  deps: CloudflaredEnableServiceDeps = {},
): Promise<CloudflaredEnableServiceResult> {
  try {
    const run =
      deps.run ??
      (() => Bun.$`sudo systemctl enable --now ${CLOUDFLARED_SERVICE_NAME}`.quiet().nothrow())
    const result = await run()
    return {
      ok: result.exitCode === 0,
      detail: result.stderr.toString().trim() || result.stdout.toString().trim(),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, detail }
  }
}
