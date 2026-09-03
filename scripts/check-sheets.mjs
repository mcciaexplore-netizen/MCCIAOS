#!/usr/bin/env node
/**
 * Answers "is the Google Sheets export actually going to work?" without
 * writing anything.
 *
 * Usage: npm run sheets:check
 *
 * The export fails in four distinct ways and the runtime error for three of
 * them is the same unhelpful 403 or 500 at 18:00, hours after anyone could act
 * on it. This runs the same four checks up front and names which one failed:
 *
 *   1. the three variables are present
 *   2. the account is a service account, not somebody's Gmail
 *   3. the key is a PEM that actually signs
 *   4. the spreadsheet has been shared with that service account
 *
 * Deliberately plain Node with no imports from server/: this has to run before
 * anything else works, so it must not need a TypeScript loader or a build.
 * The JWT below duplicates a few lines of google-sheets.ts for that reason.
 *
 * Reads only. The sheet is fetched for its tab names and nothing else.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (fix) console.log(`      ${fix}`);
  process.exitCode = 1;
};

/** Minimal .env reader. Mirrors dotenv: "\n" inside double quotes is a newline. */
function readEnvFile(file = '.env') {
  const out = {};
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const quoted = v.startsWith('"') && v.endsWith('"') && v.length > 1;
    if (quoted || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    if (quoted) v = v.replace(/\\n/g, '\n');
    out[m[1]] = v;
  }
  return out;
}

const file = readEnvFile();
// A real environment variable wins, so this works on a host with no .env too.
const get = (k) => (process.env[k] ?? file[k] ?? '').trim();

console.log('\nGoogle Sheets export — configuration check\n');

// ---- 1. present ------------------------------------------------------------
const email = get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
const rawKey = get('GOOGLE_PRIVATE_KEY');
const sheetId = get('SHEETS_SPREADSHEET_ID');

for (const [name, value] of [
  ['GOOGLE_SERVICE_ACCOUNT_EMAIL', email],
  ['GOOGLE_PRIVATE_KEY', rawKey],
  ['SHEETS_SPREADSHEET_ID', sheetId],
]) {
  if (value) ok(`${name} is set`);
  else bad(`${name} is empty`, 'Fill it in .env, and in the Vercel project for the deployed app.');
}
if (process.exitCode) {
  console.log('\nStopped: fill the missing variables first.\n');
  process.exit(1);
}

// ---- 2. a service account, not a person ------------------------------------
if (email.endsWith('.iam.gserviceaccount.com')) {
  ok(`account looks like a service account (${email})`);
} else {
  bad(
    `${email} is not a service account`,
    'A service account ends in .iam.gserviceaccount.com. Google Cloud console →\n' +
      '      IAM & Admin → Service Accounts → Create. A personal Gmail cannot sign here.',
  );
}

// ---- 3. a key that signs ---------------------------------------------------
const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
if (!privateKey.includes('BEGIN PRIVATE KEY')) {
  bad(
    'GOOGLE_PRIVATE_KEY is not a PEM key',
    'Copy the whole private_key value from the service account JSON, BEGIN/END lines included.',
  );
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt() {
  const now = Math.floor(Date.now() / 1000);
  const body =
    `${b64({ alg: 'RS256', typ: 'JWT' })}.` +
    b64({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 300 });
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(privateKey, 'base64url')}`;
}

let jwt;
try {
  jwt = signJwt();
  ok('private key parses and signs');
} catch (err) {
  bad(`private key will not sign: ${err.message}`,
      'The value is probably truncated, or its \\n sequences were turned into real line breaks by an editor.');
  console.log('\nStopped: the key must sign before anything else can be checked.\n');
  process.exit(1);
}

// ---- 4. Google accepts it, and the sheet is shared --------------------------
const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }),
});
const token = await tokenRes.json();
if (!tokenRes.ok) {
  const d = token.error_description ?? token.error ?? '';
  bad(`Google rejected the credentials: ${d}`,
      /invalid_grant/.test(JSON.stringify(token))
        ? 'Usually a deleted key or a clock far out of sync. Regenerate the JSON key.'
        : 'Check the Google Sheets API is enabled for this project.');
  console.log('');
  process.exit(1);
}
ok('Google issued an access token');

const url =
  `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
  '?fields=properties.title,sheets.properties.title';
const res = await fetch(url, { headers: { authorization: `Bearer ${token.access_token}` } });
const doc = await res.json();

if (res.status === 403) {
  bad('the service account cannot open the spreadsheet',
      `Open the sheet → Share → add ${email} as an Editor.\n` +
      '      It is an ordinary collaborator; a valid key alone grants nothing.');
} else if (res.status === 404) {
  bad('no spreadsheet with that id',
      'SHEETS_SPREADSHEET_ID is the part between /d/ and /edit in the sheet URL.');
} else if (!res.ok) {
  bad(`Sheets API returned ${res.status}: ${doc.error?.message ?? ''}`);
} else {
  ok(`can open "${doc.properties.title}"`);
  const tabs = (doc.sheets ?? []).map((s) => s.properties.title);
  console.log(`      ${tabs.length} tab${tabs.length === 1 ? '' : 's'}: ${tabs.join(', ')}`);
  console.log('\nReady. The 18:00 IST run will write to this spreadsheet.\n');
}
