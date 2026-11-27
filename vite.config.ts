import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// One stamp per build: baked into the bundle and written to dist/version.json, so a running app can tell
// when a newer build is live (src/ui/Update.tsx).
const BUILD = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const versionFile = (): Plugin => ({
  name: 'holler-version',
  apply: 'build',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD }) + '\n' }); },
});

export default defineConfig({
  plugins: [react(), versionFile()],
  base: './',
  define: { __HOLLER_BUILD__: JSON.stringify(BUILD) },
  build: {
    rollupOptions: {
      output: {
        // libraries change far less often than the app: their own files stay cached across deploys
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase';
          return undefined;
        },
      },
    },
  },
});
