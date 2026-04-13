import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/modules/state/tables.ts',
  out: './src/modules/state/drizzle',
  dialect: 'sqlite',
})
