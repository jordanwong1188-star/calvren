-- Calvren native cron records actual backend execution, not just pg_cron dispatch.
-- Aggregate job health only; no customer PII, messages, phone numbers or credentials.
create table if not exists public.calvren_scheduler_runs (
  job_name text primary key check (job_name in ('follow-ups','hub-scheduler')),
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_outcome text not null check (last_outcome in ('succeeded','failed')),
  last_processed integer not null default 0 check (last_processed >= 0),
  last_failed integer not null default 0 check (last_failed >= 0)
);
alter table public.calvren_scheduler_runs enable row level security;
revoke all on table public.calvren_scheduler_runs from public, anon, authenticated;
grant select, insert, update on table public.calvren_scheduler_runs to service_role;

create or replace function public.calvren_record_scheduler_run(
  p_job_name text, p_success boolean, p_processed integer, p_failed integer
) returns void
language plpgsql volatile security invoker set search_path = ''
as $fn$
begin
  if p_job_name not in ('follow-ups','hub-scheduler') or p_job_name is null
    or p_success is null or p_processed is null or p_failed is null
    or p_processed < 0 or p_failed < 0 or p_processed > 10000 or p_failed > 10000
  then
    raise exception 'Invalid scheduled job summary';
  end if;
  insert into public.calvren_scheduler_runs(
    job_name,last_attempt_at,last_success_at,last_failure_at,last_outcome,last_processed,last_failed
  ) values (
    p_job_name,clock_timestamp(),
    case when p_success then clock_timestamp() else null end,
    case when p_success then null else clock_timestamp() end,
    case when p_success then 'succeeded' else 'failed' end,
    p_processed,p_failed
  )
  on conflict(job_name) do update set
    last_attempt_at=excluded.last_attempt_at,
    last_success_at=coalesce(excluded.last_success_at,public.calvren_scheduler_runs.last_success_at),
    last_failure_at=coalesce(excluded.last_failure_at,public.calvren_scheduler_runs.last_failure_at),
    last_outcome=excluded.last_outcome,
    last_processed=excluded.last_processed,
    last_failed=excluded.last_failed;
end;
$fn$;
revoke all on function public.calvren_record_scheduler_run(text,boolean,integer,integer) from public, anon, authenticated;
grant execute on function public.calvren_record_scheduler_run(text,boolean,integer,integer) to service_role;

create or replace function public.calvren_operational_snapshot()
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
select jsonb_build_object(
  'checked_at', now(),
  'active_linked_clients', (select count(distinct client_id) from public.calvren_billing_memberships
    where subscription_status in ('active','trialing') and client_id is not null and current_period_end > now()),
  'failed_deliveries_7d', (select count(*) from public.calvren_hub_deliveries
    where status = 'failed' and created_at >= now() - interval '7 days'),
  'unknown_deliveries_7d', (select count(*) from public.calvren_hub_deliveries
    where status = 'unknown' and created_at >= now() - interval '7 days'),
  'oldest_unresolved_delivery', (select min(created_at) from public.calvren_hub_deliveries
    where status in ('failed','unknown') and created_at >= now() - interval '7 days'),
  'human_handoffs_pending', (select count(*) from public.calvren_leads l
    where l.data->>'status' = 'needs_human'
      and exists (select 1 from public.calvren_billing_memberships m where m.client_id=l.client_id
        and m.subscription_status in ('active','trialing') and m.current_period_end > now())),
  'onboarding_needs_details', (select count(*) from public.calvren_onboarding
    where status='needs_details'),
  'onboarding_in_progress', (select count(*) from public.calvren_onboarding
    where status in ('submitted','reviewing','building','testing','awaiting_approval','approved')),
  'followups_last_attempt_at', (select last_attempt_at from public.calvren_scheduler_runs where job_name='follow-ups'),
  'followups_last_success_at', (select last_success_at from public.calvren_scheduler_runs where job_name='follow-ups'),
  'followups_last_outcome', (select last_outcome from public.calvren_scheduler_runs where job_name='follow-ups'),
  'followups_last_processed', (select last_processed from public.calvren_scheduler_runs where job_name='follow-ups'),
  'hub_last_attempt_at', (select last_attempt_at from public.calvren_scheduler_runs where job_name='hub-scheduler'),
  'hub_last_success_at', (select last_success_at from public.calvren_scheduler_runs where job_name='hub-scheduler'),
  'hub_last_outcome', (select last_outcome from public.calvren_scheduler_runs where job_name='hub-scheduler'),
  'hub_last_processed', (select last_processed from public.calvren_scheduler_runs where job_name='hub-scheduler')
);
$fn$;
revoke all on function public.calvren_operational_snapshot() from public, anon, authenticated;
grant execute on function public.calvren_operational_snapshot() to service_role;
