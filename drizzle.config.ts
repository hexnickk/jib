import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './modules/state/tables.ts',
  out: './modules/state/drizzle',
  dialect: 'sqlite',
})
