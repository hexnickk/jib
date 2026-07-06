import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))
const src = resolve(root, 'src')
const modules = resolve(src, 'modules')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${src}/$1` },
      { find: /^@jib\/(.*)$/, replacement: `${modules}/$1/index.ts` },
      { find: /^@jib-module\/(.*)$/, replacement: `${modules}/$1/index.ts` },
    ],
  },
})
