import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: [
      'domain/**/*.test.ts',
      'storage/**/*.test.ts',
      'server/**/*.test.ts',
      'ui/**/*.test.ts',
    ],
    environment: 'node',
  },
})
