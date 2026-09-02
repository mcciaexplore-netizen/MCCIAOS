#!/usr/bin/env node
/**
 * Puts a Work Tracker backup back.
 *
 * Usage: node scripts/restore-work-tracker.mjs backups/work-tracker-<stamp>.json
 *
 * Restores every task in the file with its original id, so running it twice
 * changes nothing rather than creating duplicates. People are matched by the id
 * they had; a task whose person is no longer on the roster is reported and
 * skipped rather than quietly reassigned to somebody else.
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/restore-work-tracker.mjs <backup.json>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const { tasks } = JSON.parse(readFileSync(file, 'utf8'));
const known = new Set((await sql`select id from users`).map((u) => u.id));

let restored = 0;
const skipped = [];
for (const t of tasks) {
  if (!known.has(t.user_id)) {
    skipped.push(`${t.title} (its person is no longer on the roster)`);
    continue;
  }
  await sql`
    insert into tasks (id, user_id, title, priority, status, allocation_date,
                       due_date, deadline_date, report_to, approver_id,
                       completed_at, approved_at, created_at, updated_at)
    values (${t.id}::uuid, ${t.user_id}::uuid, ${t.title}, ${t.priority}, ${t.status},
            ${t.allocation_date}, ${t.due_date}, ${t.deadline_date},
            ${t.report_to}::uuid, ${t.approver_id}::uuid,
            ${t.completed_at}, ${t.approved_at}, ${t.created_at}, ${t.updated_at})
    on conflict (id) do nothing`;
  restored++;
}
console.log(`restored ${restored} task(s) from ${file}`);
for (const s of skipped) console.log(`  skipped: ${s}`);
