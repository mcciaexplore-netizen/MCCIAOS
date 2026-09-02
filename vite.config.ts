import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { apiMiddleware } from './server/vite-plugin';

export default defineConfig(({ mode }) => {
  // The API middleware runs in this Node process and reads process.env.
  // Vite only exposes .env to client code by default, so copy the server-side
  // keys across.
  //
  // Every server key must be listed here. A key that is in .env but missing
  // from this list is silently ignored in development, which looks exactly like
  // the feature being broken — the Sheets export was unreachable locally for
  // precisely that reason.
  const env = loadEnv(mode, process.cwd(), '');
  const serverKeys = [
    'DATABASE_URL',
    'SETTINGS_PASSCODE',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'SHEETS_SPREADSHEET_ID',
    'CRON_SECRET',
  ];
  for (const key of serverKeys) {
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
