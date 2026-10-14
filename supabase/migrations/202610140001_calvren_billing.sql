-- Private, Stripe-verified billing entitlements. Never grant from a browser return URL.
begin;
create table if not exists public.calvren_billing_memberships (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[a-zA-Z0-9]+$'),
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[a-zA-Z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[a-zA-Z0-9]+$'),
  subscription_status text not null check (subscription_status in
    ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  current_period_end timestamptz,
  client_id text references public.calvren_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calvren_membership_client on public.calvren_billing_memberships (client_id);
alter table public.calvren_billing_memberships enable row level security;
revoke all on table public.calvren_billing_memberships from public, anon, authenticated;
grant select, insert, update, delete on public.calvren_billing_memberships to service_role;
-- Deliberately no end-user table policies: the server validates Supabase Auth JWTs,
-- checks the paid entitlement, and scopes every read to this assigned client_id.
commit;
