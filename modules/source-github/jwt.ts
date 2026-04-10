import { createSign } from 'node:crypto'
import { JibError } from '@jib/core'

/**
 * Base64url encoder — GitHub JWT headers/payloads use the URL-safe variant
 * with `=` padding stripped. Node/Bun's `Buffer.toString('base64url')` handles
 * this natively, but we keep it in one place for clarity.
 */
function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf.toString('base64url')
}

export interface AppJWT {
  jwt: string
  expiresAt: Date
}

/**
 * Builds an RS256-signed JWT for a GitHub App (`iss`=appId, `iat`=now-60,
 * `exp`=now+10min per GitHub's docs). The PEM may be PKCS1 or PKCS8; Node's
 * `createSign` autodetects both. Throws if the PEM is not an RSA key.
 */
export function createAppJWT(appId: number, privateKeyPem: string): AppJWT {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 10 * 60
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: String(appId), iat: now - 60, exp }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(signingInput)
    signer.end()
    const sig = signer.sign(privateKeyPem)
    return { jwt: `${signingInput}.${base64url(sig)}`, expiresAt: new Date(exp * 1000) }
  } catch (err) {
    throw new JibError('github.jwt', `signing JWT: ${(err as Error).message}`, { cause: err })
  }
}

export interface InstallationToken {
  token: string
  expiresAt: Date
}

/**
 * Exchanges a GitHub App JWT for a short-lived installation access token by
 * POSTing to `/app/installations/<id>/access_tokens`. The returned token is
 * scoped to that installation and typically expires in an hour.
 */
export async function generateInstallationToken(
  appId: number,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationToken> {
  const { jwt } = createAppJWT(appId, privateKeyPem)
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'jib',
      },
    },
  )
  if (res.status !== 201) {
    const body = await res.text()
    throw new JibError('github.jwt', `creating access token: HTTP ${res.status}: ${body}`)
  }
  const data = (await res.json()) as { token?: string; expires_at?: string }
  if (!data.token) throw new JibError('github.jwt', 'GitHub returned no token')
  return {
    token: data.token,
    expiresAt: data.expires_at ? new Date(data.expires_at) : new Date(Date.now() + 3_600_000),
  }
}
