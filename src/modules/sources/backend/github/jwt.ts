import { createSign } from 'node:crypto'
import {
  GitHubJwtCreateAccessTokenError,
  GitHubJwtMissingTokenError,
  GitHubJwtSignError,
} from './errors.ts'

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
export function githubJwtCreateApp(
  appId: number,
  privateKeyPem: string,
): AppJWT | GitHubJwtSignError {
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
    return new GitHubJwtSignError(err)
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
export async function githubJwtGenerateInstallationToken(
  appId: number,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationToken | Error> {
  const signed = githubJwtCreateApp(appId, privateKeyPem)
  if (signed instanceof Error) return signed
  const { jwt } = signed
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
    return new GitHubJwtCreateAccessTokenError(res.status, body)
  }
  const data = (await res.json()) as { token?: string; expires_at?: string }
  if (!data.token) return new GitHubJwtMissingTokenError()
  return {
    token: data.token,
    expiresAt: data.expires_at ? new Date(data.expires_at) : new Date(Date.now() + 3_600_000),
  }
}
