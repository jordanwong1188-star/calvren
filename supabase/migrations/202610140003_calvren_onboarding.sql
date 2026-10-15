-- Calvren managed client onboarding. Client access is mediated by the authenticated Edge Function.
-- Keep intake data private; never collect API keys or passwords in this table.
begin;
create table public.calvren_onboarding (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  form jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form)='object' and pg_column_size(form)<20000),
  status text not null default 'draft'
    check (status in ('draft','submitted','reviewing','needs_details','building','testing','live')),
  current_step smallint not null default 1 check (current_step between 1 and 4),
  owner_note text not null default '' check (length(owner_note)<=1200),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index calvren_onboarding_status_updated on public.calvren_onboarding(status,updated_at desc);
-- A live automation account must not be assigned to multiple paying customer identities.
create unique index calvren_membership_unique_client on public.calvren_billing_memberships(client_id)
  where client_id is not null;
alter table public.calvren_onboarding enable row level security;
revoke all on public.calvren_onboarding from public,anon,authenticated;
grant select,insert,update on public.calvren_onboarding to service_role;
-- No browser-readable policy. Supabase service key is only used by server-side code.
commit;
