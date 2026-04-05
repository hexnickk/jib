import { describe, expect, test } from 'bun:test'
import { appConfFilename, confFilename, renderSite, renderSystemdUnit } from './templates.ts'

describe('nginx templates', () => {
  test('HTTP-only site emits port 80 server block with proxy_pass', () => {
    const out = renderSite({ host: 'example.com', port: 8080, isTunnel: false, hasSSL: false })
    expect(out).toContain('listen 80')
    expect(out).toContain('server_name example.com')
    expect(out).toContain('proxy_pass http://127.0.0.1:8080')
    expect(out).toContain('.well-known/acme-challenge')
    expect(out).not.toContain('listen 443')
  })

  test('HTTPS site emits both 80 (redirect) and 443 (ssl) blocks', () => {
    const out = renderSite({ host: 'example.com', port: 8080, isTunnel: false, hasSSL: true })
    expect(out).toContain('listen 80')
    expect(out).toContain('return 301 https://$host$request_uri')
    expect(out).toContain('listen 443 ssl')
    expect(out).toContain('/etc/letsencrypt/live/example.com/fullchain.pem')
    expect(out).toContain('/etc/letsencrypt/live/example.com/privkey.pem')
    expect(out).toContain('Strict-Transport-Security')
  })

  test('tunnel site skips ACME challenge and never emits HTTPS', () => {
    const out = renderSite({ host: 'api.example.com', port: 3000, isTunnel: true, hasSSL: true })
    expect(out).toContain('proxy_pass http://127.0.0.1:3000')
    expect(out).not.toContain('.well-known/acme-challenge')
    expect(out).not.toContain('listen 443')
  })

  test('confFilename appends .conf', () => {
    expect(confFilename('app.example.com')).toBe('app.example.com.conf')
  })

  test('appConfFilename scopes by app name', () => {
    expect(appConfFilename('web', 'web.example.com')).toBe('web-web.example.com.conf')
  })

  test('renderSystemdUnit contains JIB_ROOT, bus requirement and bin path', () => {
    const unit = renderSystemdUnit({ jibRoot: '/var/lib/jib', binPath: '/usr/local/bin/jib' })
    expect(unit).toContain('Environment=JIB_ROOT=/var/lib/jib')
    expect(unit).toContain('Requires=jib-bus.service')
    expect(unit).toContain('After=jib-bus.service')
    expect(unit).toContain('ExecStart=/usr/local/bin/jib service start nginx')
    expect(unit).toContain('[Install]')
  })
})
