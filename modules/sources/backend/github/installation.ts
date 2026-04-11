import { JibError } from '@jib/errors'
import { createAppJWT } from './jwt.ts'

interface RawInstallation {
  id: number
  account: { login: string }
}

/**
 * Lists every installation of a GitHub App using its JWT. Returns the raw
 * ID/org pairs; callers pick which one they want.
 */
export async function listInstallations(
  appId: number,
  privateKeyPem: string,
): Promise<RawInstallation[]> {
  const { jwt } = createAppJWT(appId, privateKeyPem)
  const res = await fetch('https://api.github.com/app/installations', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'jib',
    },
  })
  if (res.status !== 200) {
    const body = await res.text()
    throw new JibError('github.installation', `listing installations: HTTP ${res.status}: ${body}`)
  }
  return (await res.json()) as RawInstallation[]
}

/**
 * Finds the installation ID for a given org (the `owner` part of `owner/repo`).
 * Throws if the app isn't installed on that org. Matches Go's
 * `findInstallation`.
 */
export async function findInstallationForOrg(
  appId: number,
  privateKeyPem: string,
  org: string,
): Promise<number> {
  const installs = await listInstallations(appId, privateKeyPem)
  const match = installs.find((i) => i.account.login.toLowerCase() === org.toLowerCase())
  if (!match) throw new JibError('github.installation', `no installation found for org "${org}"`)
  return match.id
}
