// Seeds the Work Tracker with sample tasks so the screen has something to show.
//
//   node scripts/seed-work-tracker.mjs          seed
//   node scripts/seed-work-tracker.mjs --clear  remove every seeded task
//
// Only tasks are invented. Real people are never given invented attributes —
// designations and emails are left as they are, because guessing a colleague's
// job title is fabricating data about a real person.
//
// Seeded rows are found again by title prefix, so --clear cannot touch real work.
import { neon } from '../node_modules/@neondatabase/serverless/index.mjs';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const sql = neon(url);

const PREFIX = '[sample] ';

if (process.argv.includes('--clear')) {
  const gone = await sql`delete from tasks where title like ${PREFIX + '%'} returning id`;
  console.log(`removed ${gone.length} sample task(s)`);
  process.exit(0);
}

const users = await sql`select id, name from users where is_active order by name`;
if (users.length === 0) throw new Error('No users. Run db/work-tracker.sql first.');
const by = (n) => users.find((u) => u.name === n)?.id ?? users[0].id;
const pick = (i) => users[i % users.length].id;

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

// Ten tasks covering all five statuses, plus overdue, at-risk and slipped rows.
const TASKS = [
  { title: 'Auto Cluster website — vendor deck', who: 0, status: 'ongoing',   prio: 'high',   alloc: shift(-10), due: shift(6),  dl: shift(9)  },
  { title: 'GST reconciliation fix for Kirloskar', who: 1, status: 'hold',     prio: 'high',   alloc: shift(-12), due: shift(-2), dl: shift(1)  },
  { title: 'Workshop confirmation calls',          who: 2, status: 'upcoming', prio: 'medium', alloc: shift(-1),  due: shift(1),  dl: shift(3)  },
  { title: 'Web analytics dashboard setup',        who: 3, status: 'ongoing',  prio: 'high',   alloc: shift(-8),  due: shift(-1), dl: shift(2)  },
  { title: 'MSME data digitization case studies',  who: 4, status: 'completed',prio: 'medium', alloc: shift(-20), due: shift(-5), dl: shift(-3) },
  { title: 'Cluster calling list — August round',  who: 0, status: 'completed',prio: 'low',    alloc: shift(-25), due: shift(-8), dl: shift(-6) },
  { title: 'Social media creatives — festive set', who: 5, status: 'ongoing',  prio: 'medium', alloc: shift(-4),  due: shift(4),  dl: shift(7)  },
  { title: 'Consultation intake form rework',      who: 6, status: 'stopped',  prio: 'low',    alloc: shift(-15), due: shift(-6), dl: shift(-4) },
  { title: 'Mail merge for data dictionary',       who: 7, status: 'upcoming', prio: 'high',   alloc: shift(-6),  due: shift(-4), dl: shift(-2) },
  { title: 'Quarterly impact report — draft',      who: 8, status: 'ongoing',  prio: 'high',   alloc: shift(-3),  due: shift(2),  dl: shift(2)  },
];

let made = 0;
for (const t of TASKS) {
  const owner = pick(t.who);
  const approver = pick(t.who + 1);
  const rows = await sql`
    insert into tasks
      (user_id, title, priority, status, allocation_date, due_date, deadline_date,
       report_to, approver_id, completed_at)
    values (
      ${owner}::uuid, ${PREFIX + t.title}, ${t.prio}, ${t.status},
      ${t.alloc}::date, ${t.due}::date, ${t.dl}::date,
      ${approver}::uuid, ${approver}::uuid,
      ${t.status === 'completed' ? new Date().toISOString() : null}::timestamptz
    )
    returning id`;
  await sql`
    insert into task_activity (task_id, actor_id, field, old_value, new_value)
    values (${rows[0].id}::uuid, ${by(users[0].name)}::uuid, 'created', null, ${t.title})`;
  made++;
}

console.log(`seeded ${made} tasks across ${users.length} people`);
console.log('remove them again with:  node scripts/seed-work-tracker.mjs --clear');
