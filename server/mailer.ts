/**
 * A minimal mail sender: Gmail SMTP through an app password.
 *
 * CREDENTIALS. A Gmail account with 2-Step Verification turned on, and an App
 * Password generated for it (Google Account -> Security -> 2-Step Verification
 * -> App passwords). The account's own login password will not authenticate
 * here once 2-Step Verification is on.
 *
 *   MAIL_USER          the sending address, e.g. mcciaexplore@gmail.com
 *   MAIL_APP_PASSWORD  the 16-character app password (spaces are stripped)
 *   MAIL_FROM_NAME     display name on the "From" header (optional)
 *
 * Optional, like Sheets: `mailConfig()` returns null rather than throwing when
 * nothing is set, so the app and the sheet export both run fine without it.
 */
import nodemailer from 'nodemailer';

export class MailError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export interface MailConfig {
  user: string;
  appPassword: string;
  fromName: string;
}

export function mailConfig(): MailConfig | null {
  const user = process.env.MAIL_USER?.trim();
  const rawPassword = process.env.MAIL_APP_PASSWORD?.trim();
  const fromName = process.env.MAIL_FROM_NAME?.trim() || 'MCCIA OS';

  if (!user && !rawPassword) return null;

  const missing = [!user && 'MAIL_USER', !rawPassword && 'MAIL_APP_PASSWORD'].filter(Boolean);
  if (missing.length) {
    throw new MailError(`Digest email is half-configured. Missing: ${missing.join(', ')}`, 500);
  }

  // Google prints the app password in four groups of four, for reading; SMTP
  // wants it with no spaces, and the spaces come along with a careless paste.
  const appPassword = rawPassword!.replace(/\s+/g, '');
  return { user: user!, appPassword, fromName };
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterUser: string | null = null;

function getTransporter(cfg: MailConfig) {
  if (transporter && transporterUser === cfg.user) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.user, pass: cfg.appPassword },
  });
  transporterUser = cfg.user;
  return transporter;
}

/**
 * Whether the credentials actually authenticate, without sending anything.
 *
 * Mirrors `sheetsKeyUsable`: "configured" and "working" are different
 * questions, and the second one is the one worth answering before 17:00.
 */
export async function mailUsable(): Promise<{ ok: true } | { ok: false; reason: string }> {
  let cfg: MailConfig | null;
  try {
    cfg = mailConfig();
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!cfg) return { ok: false, reason: 'not configured' };
  try {
    await getTransporter(cfg).verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Gmail rejected the credentials: ${(err as Error).message}` };
  }
}

export async function sendMail(
  cfg: MailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  try {
    await getTransporter(cfg).sendMail({
      from: `"${cfg.fromName}" <${cfg.user}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    throw new MailError(`Could not email ${to}: ${(err as Error).message}`, 502);
  }
}
