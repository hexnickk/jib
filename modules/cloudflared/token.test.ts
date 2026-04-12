import { describe, expect, test } from 'bun:test'
import { cloudflaredExtractTunnelToken } from './token.ts'

describe('cloudflaredExtractTunnelToken', () => {
  test('raw token passes through', () => {
    expect(cloudflaredExtractTunnelToken('eyJhIjoiNzQ')).toBe('eyJhIjoiNzQ')
  })

  test('strips "sudo cloudflared service install" prefix', () => {
    expect(cloudflaredExtractTunnelToken('sudo cloudflared service install eyJhIjoiNzQ')).toBe(
      'eyJhIjoiNzQ',
    )
  })

  test('strips "cloudflared service install" without sudo', () => {
    expect(cloudflaredExtractTunnelToken('cloudflared service install eyJhIjoiNzQ')).toBe(
      'eyJhIjoiNzQ',
    )
  })

  test('strips "cloudflared tunnel run --token" prefix', () => {
    expect(cloudflaredExtractTunnelToken('cloudflared tunnel run --token eyJhIjoiNzQ')).toBe(
      'eyJhIjoiNzQ',
    )
  })

  test('trims whitespace', () => {
    expect(cloudflaredExtractTunnelToken('  eyJhIjoiNzQ  ')).toBe('eyJhIjoiNzQ')
  })

  test('empty input returns empty', () => {
    expect(cloudflaredExtractTunnelToken('')).toBe('')
    expect(cloudflaredExtractTunnelToken('   ')).toBe('')
  })

  test('cloudflared command with no token returns empty', () => {
    expect(cloudflaredExtractTunnelToken('sudo cloudflared service install')).toBe('')
    expect(cloudflaredExtractTunnelToken('cloudflared service install')).toBe('')
    expect(cloudflaredExtractTunnelToken('cloudflared service install ')).toBe('')
    expect(cloudflaredExtractTunnelToken('cloudflared tunnel run --token')).toBe('')
  })
})
