import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), {
    name: 'watch-learning-articles',
    configureServer(server) {
      // summarize is outside the Vite root; watch its new directories as well as imported files.
      server.watcher.add(fileURLToPath(new URL('../summarize', import.meta.url)));
    },
  }],
  base: './',
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
