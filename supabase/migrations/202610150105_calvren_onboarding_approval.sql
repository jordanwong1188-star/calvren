-- Calvren implementation lifecycle: transactional email delivery and explicit launch approval.
begin;
alter table public.calvren_billing_memberships add column if not exists welcome_email_sent_at timestamptz;
alter table public.calvren_onboarding
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists scope_review_email_sent_at timestamptz,
  add column if not exists launch_scope text not null default '',
  add column if not exists approved_scope text not null default '',
  add column if not exists scope_approved_at timestamptz;
alter table public.calvren_onboarding
  add constraint calvren_launch_scope_length check (length(launch_scope)<=2400),
  add constraint calvren_approved_scope_length check (length(approved_scope)<=2400);
alter table public.calvren_onboarding drop constraint if exists calvren_onboarding_status_check;
alter table public.calvren_onboarding add constraint calvren_onboarding_status_check
  check (status in ('draft','submitted','reviewing','needs_details','building','testing','awaiting_approval','approved','live'));
-- All onboarding records remain service-role only. There is no public approval or email table API.
commit;
