#!/usr/bin/env node
/**
 * Answers "will the digest emails actually send" without sending one.
 *
 * Usage: npm run mail:check
 *
 * Mirrors scripts/check-sheets.mjs: the same shape of problem (credentials
 * that look present but don't work) deserves the same up-front answer instead
 * of a failure at 17:00 in a log nobody reads.
 */
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (fix) console.log(`      ${fix}`);
  process.exitCode = 1;
};

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
    out[m[1]] = v;
  }
  return out;
}

const file = readEnvFile();
const get = (k) => (process.env[k] ?? file[k] ?? '').trim();

console.log('\nDaily digest email — configuration check\n');

const user = get('MAIL_USER');
const rawPassword = get('MAIL_APP_PASSWORD');

for (const [name, value] of [
  ['MAIL_USER', user],
  ['MAIL_APP_PASSWORD', rawPassword],
]) {
  if (value) ok(`${name} is set`);
  else bad(`${name} is empty`, 'Fill it in .env, and in the Vercel project for the deployed app.');
}
if (process.exitCode) {
  console.log('\nStopped: fill the missing variables first.\n');
  process.exit(1);
}

if (!/.+@.+\..+/.test(user)) {
  bad(`${user} does not look like an email address`);
  process.exit(1);
}
ok(`sending address looks right (${user})`);

const password = rawPassword.replace(/\s+/g, '');
if (password.length !== 16) {
  bad(
    `MAIL_APP_PASSWORD is ${password.length} characters, not 16`,
    'A Gmail App Password is always 16 characters once the spaces are removed. ' +
      'Google Account -> Security -> 2-Step Verification -> App passwords.',
  );
  process.exit(1);
}
ok('app password is 16 characters');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass: password },
});

try {
  await transporter.verify();
  ok('Gmail accepted the credentials');
  console.log('\nReady. The 17:00 IST run will send digest emails.\n');
} catch (err) {
  bad(
    `Gmail rejected the credentials: ${err.message}`,
    '2-Step Verification must be on for this account, and the app password must ' +
      'be freshly generated for it — the account\'s own login password will not work here.',
  );
  process.exit(1);
}
