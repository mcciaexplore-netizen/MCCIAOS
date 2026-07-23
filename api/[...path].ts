// Vercel catch-all function. Delegates every /api/* route to the same
// runtime-agnostic handler used by the Vite dev middleware.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from '../server/handlers';

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

  const result = await handleApi({
    method: req.method ?? 'GET',
    pathname: parsed.pathname,
    query: parsed.searchParams,
    headers,
    body: req.body,
    ip: (headers['x-forwarded-for']?.split(',')[0] ?? 'unknown').trim(),
  });

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
