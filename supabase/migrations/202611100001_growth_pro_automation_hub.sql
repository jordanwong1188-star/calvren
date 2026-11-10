-- Growth reviews and reporting; Pro inbox/approval-gated workflow integrations.
-- All access is mediated by Calvren's verified server / service-role key.
begin;
create table if not exists public.calvren_hub_settings (
  client_id text primary key references public.calvren_clients(id) on delete cascade,
  review_url text not null default '' check (length(review_url)<=500),
  review_enabled boolean not null default false,
  report_enabled boolean not null default false,
  pro_alert_enabled boolean not null default false,
  integration_url text not null default '' check (length(integration_url)<=500),
  integration_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.calvren_service_completions (
  client_id text not null references public.calvren_clients(id) on delete cascade,
  appointment_id uuid not null references public.calvren_appointments(id) on delete cascade,
  lead_id uuid not null,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz not null default now(),
  primary key (client_id,appointment_id),
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade
);
create index if not exists calvren_completions_due on public.calvren_service_completions(completed_at,client_id);
create table if not exists public.calvren_hub_deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.calvren_clients(id) on delete cascade,
  kind text not null check (kind in ('review','monthly_report','pro_alert','pro_webhook')),
  ref_key text not null check (length(ref_key) between 1 and 160),
  status text not null default 'pending'
    check (status in ('pending','sent','failed','unknown')),
  provider_id text not null default '' check (length(provider_id)<=180),
  last_error text not null default '' check (length(last_error)<=180),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (client_id,kind,ref_key)
);
create index if not exists calvren_hub_deliveries_status on public.calvren_hub_deliveries(status,created_at);
create table if not exists public.calvren_hub_notes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  lead_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade
);
create index if not exists calvren_hub_notes_lead on public.calvren_hub_notes(client_id,lead_id,created_at);
create table if not exists public.calvren_review_optouts (
  client_id text not null references public.calvren_clients(id) on delete cascade,
  email_sha256 text not null check (email_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (client_id,email_sha256)
);
alter table public.calvren_hub_settings enable row level security;
alter table public.calvren_service_completions enable row level security;
alter table public.calvren_hub_deliveries enable row level security;
alter table public.calvren_hub_notes enable row level security;
alter table public.calvren_review_optouts enable row level security;
revoke all on public.calvren_hub_settings,public.calvren_service_completions,
  public.calvren_hub_deliveries,public.calvren_hub_notes,public.calvren_review_optouts
  from public,anon,authenticated;
grant select,insert,update,delete on public.calvren_hub_settings,public.calvren_service_completions,
  public.calvren_hub_deliveries,public.calvren_hub_notes,public.calvren_review_optouts to service_role;
commit;
