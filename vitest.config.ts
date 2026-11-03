// Unit tests run in plain Node (no WebGL, no Cloudflare runtime): pure logic only. `npm test`
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});
