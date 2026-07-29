// Brand constants shared by the app and the server-side PDF reports.
//
// The logo lives here as a data URI rather than as a file in public/ because
// it has two consumers with different needs: the browser, and the PDF
// generator running inside a serverless function. A function cannot rely on
// reading public/ — that directory is served as static assets and is not
// guaranteed to be traced into the function bundle — so a path would work in
// dev and fail in production. Embedding it makes one source of truth that
// bundles everywhere.
//
// To set or replace the logo, run:
//
//   npm run logo -- path/to/mccia-logo.png
//
// which rewrites LOGO_DATA_URI below. Until then it stays empty and both
// consumers fall back cleanly: the app shows a lettermark, the PDF shows its
// wordmark heading alone.

export const APP_NAME = 'MCCIA OS';
export const APP_TAGLINE = 'Applied AI Studio';

/**
 * Populated by scripts/set-logo.mjs. Empty means "no logo installed yet".
 * Explicitly typed as string so the empty default is not narrowed to the ''
 * literal, which would make every branch below unreachable to the compiler.
 */
export const LOGO_DATA_URI: string = '';

export const hasLogo = () => LOGO_DATA_URI.length > 0;

/**
 * Raw bytes of the logo, for consumers that cannot take a data URI — pdfkit
 * wants a Buffer. Returns null when no logo is installed.
 */
export function logoBytes(): Uint8Array | null {
  if (!LOGO_DATA_URI) return null;
  const comma = LOGO_DATA_URI.indexOf(',');
  if (comma === -1) return null;
  const b64 = LOGO_DATA_URI.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
