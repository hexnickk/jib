import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type Paths, credsPath } from '@jib/paths'
import { SERVICE_NAME } from './templates.ts'
import { extractTunnelToken } from './token.ts'

interface CommandResultLike {
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

interface CloudflaredServiceDeps {
  run?: () => Promise<CommandResultLike>
}

export interface CloudflaredServiceResult {
  detail: string
  ok: boolean
}

export function tunnelTokenPath(paths: Paths): string {
  return credsPath(paths, 'cloudflare', 'tunnel.env')
}

export function hasTunnelToken(paths: Paths): boolean {
  const path = tunnelTokenPath(paths)
  return existsSync(path) && readFileSync(path, 'utf8').trim().length > 0
}

export async function saveTunnelToken(paths: Paths, raw: string): Promise<boolean> {
  const token = extractTunnelToken(raw)
  if (!token) return false

  const path = tunnelTokenPath(paths)
  await mkdir(dirname(path), { recursive: true, mode: 0o750 })
  await writeFile(path, `TUNNEL_TOKEN=${token}\n`, { mode: 0o640 })
  return true
}

export async function enableCloudflaredService(
  deps: CloudflaredServiceDeps = {},
): Promise<CloudflaredServiceResult> {
  const run =
    deps.run ?? (() => Bun.$`sudo systemctl enable --now ${SERVICE_NAME}`.quiet().nothrow())
  const result = await run()
  return {
    ok: result.exitCode === 0,
    detail: result.stderr.toString().trim() || result.stdout.toString().trim(),
  }
}
