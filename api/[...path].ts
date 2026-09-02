// Vercel catch-all function. Delegates every /api/* route to the same
// runtime-agnostic handler used by the Vite dev middleware.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from '../server/handlers.js';

interface VercelReq extends IncomingMessage {
  method?: string;
  url?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export default async function handler(req: VercelReq, res: ServerResponse) {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  }

  try {
    const result = await handleApi({
      method: req.method ?? 'GET',
      pathname: parsed.pathname,
      query: parsed.searchParams,
      headers,
      body: req.body,
      ip: (headers['x-forwarded-for']?.split(',')[0] ?? 'unknown').trim(),
    });

    send(res, result.status, result.body, result.headers, result.binary);
  } catch (err) {
    // Mirrors the dev middleware: an unhandled failure (most likely the
    // database being unreachable) must still come back as JSON, because the
    // client parses every response as JSON.
    //
    // The message is passed through rather than replaced with "Internal server
    // error". This is an internal tool, the failures here are configuration
    // ones — DATABASE_URL unset, database unreachable — and a generic string
    // leaves whoever is on call with nothing to act on. Only the message is
    // sent, never the stack.
    // eslint-disable-next-line no-console
    console.error('[api] error', err);
    send(res, 500, { error: (err as Error)?.message || 'Internal server error' });
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
  binary?: boolean,
) {
  // Matches the dev middleware: API responses are live state and must never be
  // served from a browser cache.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
  if (binary) {
    // Already-encoded bytes (xlsx, pdf). Content-Type came from the caller.
    res.end(Buffer.from(body as Uint8Array));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
