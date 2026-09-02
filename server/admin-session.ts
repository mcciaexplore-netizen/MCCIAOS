/**
 * Admin sessions.
 *
 * WHAT THIS APP HAS, AND DOES NOT. There are no user accounts here — no login,
 * no roles, no user table beyond a roster of names that fills dropdowns. So
 * "admin" is not a role somebody holds; it is a password somebody knows. There
 * is nobody to hide the Settings link *from*, because every visitor is
 * anonymous and identical until they present the password.
 *
 * What that password buys is a session, and this module is the whole of it:
 *
 *   - verified server-side, so the password never reaches the bundle
 *   - carried in an HttpOnly cookie, so page scripts cannot read it. The
 *     previous scheme kept it in sessionStorage and sent it as a header, which
 *     any injected script could lift wholesale
 *   - SameSite=Strict, so another origin cannot ride the session
 *   - Secure in production
 *   - expiring, and revocable by logout
 *
 * STATELESS. The cookie is `<expiry>.<hmac>`, signed with a key derived from
 * the password. There is no session store because there is nowhere durable to
 * put one that every serverless invocation would share. Two useful consequences
 * fall out: changing ADMIN_SETTINGS_PASSWORD invalidates every live session,
 * and a stolen cookie stops working at its expiry rather than forever.
 *
 * WHAT IT IS NOT. Still not authentication. One password is shared by everyone
 * who administers this app, so a session proves somebody knew it — never who
 * they were. Nothing here can attribute a change to a person.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'mccia_admin';

/** Eight hours: a working day, so nobody is re-typing it after lunch. */
const SESSION_MS = 8 * 60 * 60 * 1000;

/**
 * The admin password.
 *
 * ADMIN_SETTINGS_PASSWORD is the name to use. SETTINGS_PASSCODE is still read
 * so an existing deployment does not lose access the moment this ships; it is
 * the older name for the same thing.
 *
 * Returns null when nothing is configured, in every environment including
 * development. There is deliberately no fallback: a default written here is a
 * password published to everyone who can read the repository, and a forgotten
 * environment variable would silently keep accepting it while looking exactly
 * as though the real one had taken effect. Refusing is louder and safer.
 */
export function adminPassword(): string | null {
  return (
    process.env.ADMIN_SETTINGS_PASSWORD?.trim() ||
    process.env.SETTINGS_PASSCODE?.trim() ||
    null
  );
}

/**
 * Passwords that must never be used, because they are in this repository's
 * history and anyone with repo access can read them.
 *
 * Compared as SHA-256 digests so the list itself does not reintroduce the
 * literals it exists to forbid.
 */
const PUBLISHED_DIGESTS = new Set([
  // The former development fallback, committed in db5f6e8, bcbd75c and
  // 4942436. Named by its digest rather than its text: writing it here would
  // re-publish the very string this list exists to forbid.
  'f851f3afffa4a786a9295c8076eb2eac94683cd131fd6783d566b0ee807b51e4',
]);

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface PasswordWarning {
  level: 'severe' | 'weak';
  message: string;
}

/**
 * Complains about a configured password without refusing it.
 *
 * Deliberately advisory. Refusing to start over a strength heuristic would lock
 * somebody out of their own application on a guess, and the operator setting an
 * environment variable is trusted by definition — the app cannot tell a short
 * password chosen on purpose from a mistake. What it *can* tell, exactly and
 * without guessing, is that a specific string has been published; that is worth
 * saying loudly every time the process starts.
 */
export function passwordWarning(): PasswordWarning | null {
  const password = adminPassword();
  if (!password) return null;

  if (PUBLISHED_DIGESTS.has(digest(password))) {
    return {
      level: 'severe',
      message:
        'The admin password is one that appears in this repository\u2019s git history. Anyone with repo access can read it. Change ADMIN_SETTINGS_PASSWORD.',
    };
  }
  if (password.length < 12) {
    return {
      level: 'weak',
      message: `The admin password is ${password.length} characters. It is the only thing standing in front of Settings; 16 or more is worth the extra typing.`,
    };
  }
  return null;
}

/** Not the password itself, so the cookie reveals nothing about it. */
function signingKey(password: string): string {
  return createHmac('sha256', 'mccia-os/admin-session/v1').update(password).digest('hex');
}

function sign(expiry: number, password: string): string {
  return createHmac('sha256', signingKey(password)).update(String(expiry)).digest('hex');
}

/** Constant-time, so a wrong token cannot be refined one byte at a time. */
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Constant-time password comparison, for the same reason. */
export function passwordMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface IssuedSession {
  token: string;
  expiresAt: number;
}

export function issueSession(password: string, now = Date.now()): IssuedSession {
  const expiresAt = now + SESSION_MS;
  return { token: `${expiresAt}.${sign(expiresAt, password)}`, expiresAt };
}

export interface SessionState {
  valid: boolean;
  expiresAt: number | null;
  /** Distinguishes "your session ran out" from "you never had one". */
  reason?: 'absent' | 'malformed' | 'expired' | 'bad-signature' | 'not-configured';
}

export function readSession(cookieHeader: string | undefined, now = Date.now()): SessionState {
  const password = adminPassword();
  if (!password) return { valid: false, expiresAt: null, reason: 'not-configured' };

  const raw = parseCookies(cookieHeader)[ADMIN_COOKIE];
  if (!raw) return { valid: false, expiresAt: null, reason: 'absent' };

  const [expiryPart, signature] = raw.split('.');
  const expiresAt = Number(expiryPart);
  if (!signature || !Number.isFinite(expiresAt)) {
    return { valid: false, expiresAt: null, reason: 'malformed' };
  }

  // Signature first: an expired-but-forged cookie should not be told it merely
  // expired, which would confirm the expiry format is being parsed.
  if (!sameSignature(signature, sign(expiresAt, password))) {
    return { valid: false, expiresAt: null, reason: 'bad-signature' };
  }
  if (expiresAt <= now) return { valid: false, expiresAt, reason: 'expired' };

  return { valid: true, expiresAt };
}

export function isAdmin(cookieHeader: string | undefined, now = Date.now()): boolean {
  return readSession(cookieHeader, now).valid;
}

function cookieFlags(): string {
  // Secure only where there is TLS; localhost is plain http and the cookie
  // would simply never be stored.
  const secure = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
  return [
    'Path=/',
    'HttpOnly',
    // Strict rather than Lax: nothing here is reached by following a link from
    // elsewhere, so there is no navigation case that needs the looser setting.
    'SameSite=Strict',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function sessionCookie(token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${ADMIN_COOKIE}=${token}; ${cookieFlags()}; Max-Age=${maxAge}`;
}

/** Same attributes, emptied and expired — anything else leaves it in place. */
export function clearedCookie(): string {
  return `${ADMIN_COOKIE}=; ${cookieFlags()}; Max-Age=0`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
