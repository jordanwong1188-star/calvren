-- Email capture for the public simulation. This is not Supabase Auth or a verified account.
-- The existing private table's RLS/grants continue to deny browser access.
alter table public.calvren_private_records drop constraint calvren_private_records_key_check;
alter table public.calvren_private_records add constraint calvren_private_records_key_check
  check (key ~ '^(leads|tombstones|feedback|demo-signups)/[a-f0-9-]{36}$');
