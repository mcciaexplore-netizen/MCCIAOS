import { createTask, updateTask, listChangesOn, listUsers, deleteTask } from '../server/work-tracker.js';
import { istDate } from '../src/lib/ist.js';

const day = istDate(new Date());
const people = await listUsers(true);
const me = people[0];
if (!me) throw new Error('no users on this branch');
console.log('acting as', me.name);

const t = await createTask(
  { userId: me.id, title: 'LOG VERIFY probe', priority: 'medium', status: 'upcoming', percentage: 10 } as any,
  me.id,
);

// The three fields that had never once been logged in production.
await updateTask(t.id, { percentage: 55 } as any, me.id);
await updateTask(t.id, { status: 'ongoing' } as any, me.id);
await updateTask(t.id, { dueDate: '2026-09-30' } as any, me.id);

const changes = (await listChangesOn(day)).filter((c) => c.title === 'LOG VERIFY probe');
console.table(changes.map((c) => ({ at: c.at, by: c.actorName, whose: c.ownerName, field: c.field, from: c.oldValue, to: c.newValue })));

const got = new Set(changes.map((c) => c.field));
let ok = true;
for (const f of ['created', 'percentage', 'status', 'dueDate']) {
  const pass = got.has(f);
  if (!pass) ok = false;
  console.log(pass ? `  PASS  ${f} logged` : `  FAIL  ${f} NOT logged`);
}
await deleteTask(t.id, me.id);
console.log('probe removed;', ok ? 'ALL PASS' : 'FAILURES ABOVE');
