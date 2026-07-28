import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { apiMiddleware } from './server/vite-plugin';

export default defineConfig(({ mode }) => {
  // The API middleware runs in this Node process and reads process.env.
  // Vite only exposes .env to client code by default, so copy the
  // server-side keys across.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['DATABASE_URL']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), apiMiddleware()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});
