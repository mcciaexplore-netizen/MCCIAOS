#!/usr/bin/env node
/**
 * Runs a .sql file against DATABASE_URL.
 *
 * Usage: node scripts/migrate.mjs db/work-tracker-history.sql
 *
 * The Neon HTTP driver takes one statement per call, so the file has to be
 * split. Splitting on ";" naively is wrong and has broken a migration here
 * before: a semicolon inside a comment cut a statement in half and everything
 * after it failed in a cascade that pointed nowhere near the real cause. This
 * splitter tracks the four places a semicolon does not end a statement —
 * `--` line comments, block comments, quoted strings, and $tag$ blocks.
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/migrate.mjs <file.sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

/** Splits SQL into statements, ignoring semicolons that do not terminate one. */
function statements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2; // doubled quote is an escape
          else break;
        } else j++;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const sql = neon(process.env.DATABASE_URL, {
  // Notices carry the migration's own progress reports; without this they are
  // silently dropped and a run that did nothing looks the same as one that did.
  fullResults: false,
});

const parts = statements(readFileSync(file, 'utf8'));
console.log(`${file}: ${parts.length} statement(s)`);

for (const [n, stmt] of parts.entries()) {
  const label = stmt.replace(/\s+/g, ' ').slice(0, 72);
  try {
    await sql.query(stmt);
    console.log(`  ${String(n + 1).padStart(2)}. ok   ${label}`);
  } catch (err) {
    console.error(`  ${String(n + 1).padStart(2)}. FAIL ${label}`);
    console.error(`      ${err.message}`);
    process.exit(1);
  }
}
console.log('done');
