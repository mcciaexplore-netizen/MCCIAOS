// Seeds the Work Tracker with sample tasks so the screen has something to show.
//
//   node scripts/seed-work-tracker.mjs          seed
//   node scripts/seed-work-tracker.mjs --clear  remove every seeded task
//
// Only tasks are invented. Real people are never given invented attributes —
// designations and emails are left as they are, because guessing a colleague's
// job title is fabricating data about a real person.
//
// Seeded rows carry a marker in `description` so --clear can find them again.
import { neon } from '../node_modules/@neondatabase/serverless/index.mjs';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const sql = neon(url);

const MARKER = '[sample]';

const users = await sql`select id, name from users where is_active order by name`;
if (users.length === 0) throw new Error('No users. Run db/work-tracker.sql first.');
const by = (n) => users.find((u) => u.name === n)?.id ?? users[0].id;

if (process.argv.includes('--clear')) {
  const gone = await sql`delete from tasks where description like ${'%' + MARKER} returning ref`;
  console.log(`removed ${gone.length} sample task(s)`);
  process.exit(0);
}

// IST calendar day, so seeded dates line up with what the app computes.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (d) => {
  const [y, m, dd] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

// Ten tasks covering every status, two of them shared.
const TASKS = [
  { title: 'Auto Cluster website — vendor deck',       owner: 'Rutuja', status: 'in_progress',  priority: 'high',     due: shift(6),  dl: shift(9),  approver: 'Sujal',  with: [['Taniya', 'contributor', shift(4)]] },
  { title: 'GST reconciliation fix for Kirloskar',      owner: 'Sujal',  status: 'blocked',      priority: 'critical', due: shift(-2), dl: shift(1),  approver: 'Ismail', with: [['Pratik', 'reviewer', null]] },
  { title: 'Workshop confirmation calls — September',   owner: 'Taniya', status: 'not_started',  priority: 'medium',   due: shift(1),  dl: shift(3),  approver: 'Rutuja', with: [] },
  { title: 'Web analytics dashboard — initial setup',   owner: 'Taniya', status: 'submitted',    priority: 'high',     due: shift(-1), dl: shift(2),  approver: 'Sujal',  with: [] },
  { title: 'MSME data digitization — case studies',     owner: 'Rutuja', status: 'approved',     priority: 'medium',   due: shift(-5), dl: shift(-3), approver: 'Ismail', with: [] },
  { title: 'Cluster calling list — August round',       owner: 'Rutuja', status: 'completed',    priority: 'low',      due: shift(-8), dl: shift(-6), approver: 'Ismail', with: [] },
  { title: 'Social media creatives — festive set',      owner: 'Ziya',   status: 'in_progress',  priority: 'medium',   due: shift(4),  dl: shift(7),  approver: 'Taniya', with: [] },
  { title: 'Consultation intake form rework',           owner: 'Pratik', status: 'not_started',  priority: 'low',      due: shift(11), dl: shift(14), approver: 'Sujal',  with: [] },
  { title: 'Mail merge for data dictionary outreach',   owner: 'Ismail', status: 'blocked',      priority: 'high',     due: shift(-3), dl: shift(0),  approver: 'Sujal',  with: [] },
  { title: 'Quarterly impact report — draft',           owner: 'Sujal',  status: 'not_started',  priority: 'critical', due: shift(2),  dl: shift(2),  approver: 'Ismail', with: [] },
];

let made = 0;
for (const t of TASKS) {
  const rows = await sql`
    insert into tasks
      (title, description, status, priority, assignee_id, allocated_by, report_to,
       approver_id, due_date, deadline, completed_at, approved_at)
    values (
      ${t.title},
      ${'Sample data for the Work Tracker. ' + MARKER},
      ${t.status}, ${t.priority},
      ${by(t.owner)}::uuid, ${by('Sujal')}::uuid, ${by(t.approver)}::uuid,
      ${by(t.approver)}::uuid,
      ${t.due}::date, ${t.dl}::date,
      ${['submitted', 'approved', 'completed'].includes(t.status) ? new Date().toISOString() : null}::timestamptz,
      ${['approved', 'completed'].includes(t.status) ? new Date().toISOString() : null}::timestamptz
    )
    returning id, ref`;
  const task = rows[0];
  made++;

  for (const [name, role, memberDue] of t.with) {
    await sql`
      insert into task_collaborators (task_id, user_id, role, member_due_date)
      values (${task.id}::uuid, ${by(name)}::uuid, ${role}, ${memberDue}::date)
      on conflict do nothing`;
  }

  await sql`
    insert into task_activity (task_id, actor_id, field, old_value, new_value)
    values (${task.id}::uuid, ${by('Sujal')}::uuid, 'created', null, ${t.title})`;
}

const shared = await sql`
  select count(distinct task_id)::int n from task_collaborators`;
console.log(`seeded ${made} tasks, ${shared[0].n} of them shared`);
console.log('remove them again with:  node scripts/seed-work-tracker.mjs --clear');
