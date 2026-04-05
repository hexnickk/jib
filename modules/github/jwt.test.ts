import { describe, expect, test } from 'bun:test'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { createAppJWT } from './jwt.ts'

/**
 * Roundtrip: sign a JWT with a freshly generated RSA keypair, then verify the
 * signature with the public half. This catches any future Bun regression in
 * Node's `crypto.createSign('RSA-SHA256')` path.
 */
describe('createAppJWT', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  test('produces a valid RS256 JWT', () => {
    const { jwt, expiresAt } = createAppJWT(12345, privateKey)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)
    const [h, p, s] = parts as [string, string, string]

    const header = JSON.parse(Buffer.from(h, 'base64url').toString())
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(payload.iss).toBe('12345')
    expect(payload.exp).toBeGreaterThan(payload.iat)

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${h}.${p}`)
    verifier.end()
    const ok = verifier.verify(publicKey, Buffer.from(s, 'base64url'))
    expect(ok).toBe(true)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('rejects non-RSA PEMs', () => {
    expect(() => createAppJWT(1, 'not a pem')).toThrow(/signing JWT/)
  })
})
