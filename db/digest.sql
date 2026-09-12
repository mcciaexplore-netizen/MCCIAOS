-- Daily digest emails: idempotency guard.
--
-- RUN TWICE, WRITTEN ONCE, same rule as the sheet export. A cron that fires
-- twice, a forced rerun, or "Run now" pressed after the scheduled run already
-- went out must not re-email the whole team. One row per IST day, written only
-- once mail is actually configured and every send for that day has been
-- attempted — a day skipped because mail wasn't set up yet leaves no row, so
-- the next run that day (after credentials are added) still sends.
--
-- Idempotent. Run after db/org-settings.sql.

create table if not exists digest_log (
  day     date primary key,
  sent_at timestamptz not null default now()
);
