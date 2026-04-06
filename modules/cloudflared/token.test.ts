import { describe, expect, test } from 'bun:test'
import { extractTunnelToken } from './token.ts'

describe('extractTunnelToken', () => {
  test('raw token passes through', () => {
    expect(extractTunnelToken('eyJhIjoiNzQ')).toBe('eyJhIjoiNzQ')
  })

  test('strips "sudo cloudflared service install" prefix', () => {
    expect(extractTunnelToken('sudo cloudflared service install eyJhIjoiNzQ')).toBe('eyJhIjoiNzQ')
  })

  test('strips "cloudflared service install" without sudo', () => {
    expect(extractTunnelToken('cloudflared service install eyJhIjoiNzQ')).toBe('eyJhIjoiNzQ')
  })

  test('strips "cloudflared tunnel run --token" prefix', () => {
    expect(extractTunnelToken('cloudflared tunnel run --token eyJhIjoiNzQ')).toBe('eyJhIjoiNzQ')
  })

  test('trims whitespace', () => {
    expect(extractTunnelToken('  eyJhIjoiNzQ  ')).toBe('eyJhIjoiNzQ')
  })

  test('empty input returns empty', () => {
    expect(extractTunnelToken('')).toBe('')
    expect(extractTunnelToken('   ')).toBe('')
  })

  test('cloudflared command with no token returns empty', () => {
    expect(extractTunnelToken('sudo cloudflared service install')).toBe('')
    expect(extractTunnelToken('cloudflared service install')).toBe('')
    expect(extractTunnelToken('cloudflared service install ')).toBe('')
    expect(extractTunnelToken('cloudflared tunnel run --token')).toBe('')
  })
})
