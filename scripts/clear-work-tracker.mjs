#!/usr/bin/env node
/**
 * Empties the Work Tracker.
 *
 * Usage: node scripts/clear-work-tracker.mjs --yes
 *
 * Removes every task and its activity trail. The roster in `users` is left
 * alone — people are managed on the Settings page, and deleting them would
 * orphan anything restored afterwards.
 *
 * Writes a JSON backup to backups/ before deleting anything, and prints the
 * command that puts it back. Refuses to run without --yes so it cannot be
 * triggered by a stray shell history entry.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

if (!process.argv.includes('--yes')) {
  console.error('This deletes every task. Re-run with --yes if that is what you want.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const tasks = await sql`
  select t.*, u.name as user_name
    from tasks t join users u on u.id = t.user_id
   order by t.created_at`;

if (tasks.length === 0) {
  console.log('The Work Tracker is already empty. Nothing to do.');
  process.exit(0);
}

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = `backups/work-tracker-${stamp}.json`;
const activity = await sql`select * from task_activity`;
writeFileSync(
  path,
  JSON.stringify({ savedAt: new Date().toISOString(), tasks, task_activity: activity }, null, 2),
);
console.log(`backed up ${tasks.length} task(s) -> ${path}`);
for (const t of tasks) console.log(`   - ${t.title}  |  ${t.user_name}`);

await sql`delete from task_activity`;
const removed = await sql`delete from tasks returning id`;

console.log(`\ncleared ${removed.length} task(s)`);
console.log(`roster kept: ${(await sql`select count(*)::int n from users`)[0].n} people`);
console.log(`\nto put them back:\n  node scripts/restore-work-tracker.mjs ${path}`);
