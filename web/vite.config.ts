import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'development-deployment',
    configureServer(server) {
      // Development reads the same verified export; no second deployment map.
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path || !/^\/(imd-deployment\.json|abi\/[A-Za-z0-9_]+\.json)$/.test(path)) return next();
        try {
          const bytes = await readFile(new URL(`../dist${path}`, import.meta.url));
          response.setHeader('Content-Type', 'application/json');
          response.end(bytes);
        } catch {
          response.statusCode = 503;
          response.end('Build the verified deployment export with npm run build first.');
        }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
