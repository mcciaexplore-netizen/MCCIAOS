// Mounts the runtime-agnostic API handler as Vite dev middleware, so
// /api/* works during `npm run dev` through the same runtime-agnostic handler.

import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** Methods whose requests may carry a body. */
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function apiMiddleware(): Plugin {
  return {
    name: 'mccia-api-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        try {
          // Load the handler through Vite so '@' aliases + TS resolve.
          const mod = await server.ssrLoadModule('/server/handlers.ts');
          const handleApi = mod.handleApi as typeof import('./handlers.js').handleApi;

          const parsed = new URL(url, 'http://localhost');
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
          }

          // Every method that can carry one. PUT was missing, so a PUT arrived
          // with no body in development and a full one behind a real server —
          // saw an empty patch, validated it happily and saved nothing, with a
          // 200 to say so. Divergence between the two runtimes is worse than
          // either behaviour on its own.
          const body = METHODS_WITH_BODY.has(req.method ?? '')
            ? await readBody(req)
            : undefined;

          const result = await handleApi({
            method: req.method ?? 'GET',
            pathname: parsed.pathname,
            query: parsed.searchParams,
            headers,
            body,
            ip:
              (headers['x-forwarded-for']?.split(',')[0] ?? '').trim() ||
              req.socket.remoteAddress ||
              'unknown',
          });

          sendJson(res, result.status, result.body, result.headers, result.binary);
        } catch (err) {
          // Same reasoning as api/[...path].ts: surface the message so a
          // misconfiguration is readable in the UI, not just the terminal.
          // eslint-disable-next-line no-console
          console.error('[api] error', err);
          sendJson(res, 500, {
            error: (err as Error)?.message || 'Internal server error',
          });
        }
      });
    },
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
  binary?: boolean,
) {
  res.statusCode = status;
  // Never cached. Every route here returns live state — the session endpoint
  // most of all, where a stale 200 tells somebody they are signed out (or in)
  // when they are not. A 200 with no cache headers is fair game for a browser's
  // heuristic cache, which is exactly how a fixed sign-in screen kept showing
  // the old answer.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
  if (binary) {
    // Mirrors api/[...path].ts so downloads behave the same in dev.
    res.end(Buffer.from(body as Uint8Array));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
