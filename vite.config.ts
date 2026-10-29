import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600, // three.js alone is ~515 kB (128 kB gzipped)
    rollupOptions: {
      output: {
        // three.js in its own long-cached chunk: game updates don't force re-downloading it.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
