import { InternalError, NotFoundError } from '@jib/errors'
import { githubJwtCreateApp } from './jwt.ts'

interface RawInstallation {
  id: number
  account: { login: string }
}

/** Lists every installation of a GitHub App. */
export async function githubInstallationList(
  appId: number,
  privateKeyPem: string,
): Promise<RawInstallation[] | InternalError> {
  const signed = githubJwtCreateApp(appId, privateKeyPem)
  if (signed instanceof Error) {
    return signed
  }

  let response: Response
  try {
    response = await fetch('https://api.github.com/app/installations', {
      headers: {
        Authorization: `Bearer ${signed.jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'jib',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`listing installations: ${message}`, { cause: error })
  }

  try {
    if (response.status !== 200) {
      return new InternalError(
        `listing installations: HTTP ${response.status}: ${await response.text()}`,
      )
    }
    return (await response.json()) as RawInstallation[]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`reading installations response: ${message}`, { cause: error })
  }
}

/** Finds the installation ID for a given GitHub organization. */
export async function githubInstallationFindForOrg(
  appId: number,
  privateKeyPem: string,
  org: string,
): Promise<number | InternalError | NotFoundError> {
  const installs = await githubInstallationList(appId, privateKeyPem)
  if (installs instanceof Error) {
    return installs
  }
  const match = installs.find(
    (installation) => installation.account.login.toLowerCase() === org.toLowerCase(),
  )
  if (!match) {
    return new NotFoundError(`no installation found for org "${org}"`)
  }
  return match.id
}
