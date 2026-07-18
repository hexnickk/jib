import { createSign } from 'node:crypto'
import { InternalError } from '@jib/errors'

/** Base64url encoder for GitHub JWT headers and payloads. */
function base64url(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data
  return buffer.toString('base64url')
}

export interface AppJWT {
  jwt: string
  expiresAt: Date
}

/** Builds an RS256-signed JWT for a GitHub App. */
export function githubJwtCreateApp(appId: number, privateKeyPem: string): AppJWT | InternalError {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 10 * 60
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: String(appId), iat: now - 60, exp }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(signingInput)
    signer.end()
    const signature = signer.sign(privateKeyPem)
    return { jwt: `${signingInput}.${base64url(signature)}`, expiresAt: new Date(exp * 1000) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`signing JWT: ${message}`, { cause: error })
  }
}

export interface InstallationToken {
  token: string
  expiresAt: Date
}

/** Exchanges a GitHub App JWT for a short-lived installation access token. */
export async function githubJwtGenerateInstallationToken(
  appId: number,
  privateKeyPem: string,
  installationId: number,
): Promise<InstallationToken | InternalError> {
  const signed = githubJwtCreateApp(appId, privateKeyPem)
  if (signed instanceof Error) {
    return signed
  }

  let response: Response
  try {
    response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signed.jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'jib',
        },
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`creating access token: ${message}`, { cause: error })
  }

  try {
    if (response.status !== 201) {
      return new InternalError(
        `creating access token: HTTP ${response.status}: ${await response.text()}`,
      )
    }
    const data = (await response.json()) as { token?: string; expires_at?: string }
    if (!data.token) {
      return new InternalError('GitHub returned no token')
    }
    return {
      token: data.token,
      expiresAt: data.expires_at ? new Date(data.expires_at) : new Date(Date.now() + 3_600_000),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`reading access token response: ${message}`, { cause: error })
  }
}
