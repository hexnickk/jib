import { GitHubInstallationListError, GitHubInstallationNotFoundError } from './errors.ts'
import { githubJwtCreateApp } from './jwt.ts'

interface RawInstallation {
  id: number
  account: { login: string }
}

/**
 * Lists every installation of a GitHub App using its JWT. Returns the raw
 * ID/org pairs; callers pick which one they want.
 */
export async function githubInstallationList(
  appId: number,
  privateKeyPem: string,
): Promise<RawInstallation[] | Error> {
  const signed = githubJwtCreateApp(appId, privateKeyPem)
  if (signed instanceof Error) return signed
  const { jwt } = signed
  const res = await fetch('https://api.github.com/app/installations', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'jib',
    },
  })
  if (res.status !== 200) {
    const body = await res.text()
    return new GitHubInstallationListError(res.status, body)
  }
  return (await res.json()) as RawInstallation[]
}

/**
 * Finds the installation ID for a given org (the `owner` part of `owner/repo`).
 * Throws if the app isn't installed on that org. Matches Go's
 * `findInstallation`.
 */
export async function githubInstallationFindForOrg(
  appId: number,
  privateKeyPem: string,
  org: string,
): Promise<number | Error> {
  const installs = await githubInstallationList(appId, privateKeyPem)
  if (installs instanceof Error) return installs
  const match = installs.find((i) => i.account.login.toLowerCase() === org.toLowerCase())
  if (!match) return new GitHubInstallationNotFoundError(org)
  return match.id
}
