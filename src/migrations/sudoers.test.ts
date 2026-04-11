import { describe, expect, test } from 'bun:test'
import { buildSudoersContent } from './index.ts'

describe('buildSudoersContent', () => {
  test('includes nginx validation and reload privileges', () => {
    const content = buildSudoersContent()
    expect(content).toContain('/usr/bin/systemctl reload nginx')
    expect(content).toContain('/usr/sbin/nginx -t')
  })
})
