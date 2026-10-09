
-- Private storage for the existing marketing inbox and feedback; no browser grants.
create table if not exists public.calvren_private_records (
  key text primary key check (key ~ '^(leads|tombstones|feedback)/[a-f0-9-]{36}$'),
  data jsonb not null,
  etag uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.calvren_private_records enable row level security;
revoke all on public.calvren_private_records from public, anon, authenticated;
grant select, insert, update, delete on public.calvren_private_records to service_role;

create or replace function public.calvren_private_write(p_key text, p_data jsonb, p_only_new boolean default false, p_expected_etag uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare revision uuid;
begin
  if p_only_new and p_expected_etag is not null then raise exception 'Conflicting write conditions' using errcode = '22023'; end if;
  if p_expected_etag is not null then
    update public.calvren_private_records set data = p_data, etag = gen_random_uuid()
    where key = p_key and etag = p_expected_etag returning etag into revision;
  elsif p_only_new then
    insert into public.calvren_private_records(key,data) values(p_key,p_data)
    on conflict (key) do nothing returning etag into revision;
  else
    insert into public.calvren_private_records(key,data) values(p_key,p_data)
    on conflict (key) do update set data = excluded.data, etag = gen_random_uuid()
    returning etag into revision;
  end if;
  return jsonb_build_object('modified', revision is not null, 'etag', revision);
end $$;
revoke all on function public.calvren_private_write(text,jsonb,boolean,uuid) from public, anon, authenticated;
grant execute on function public.calvren_private_write(text,jsonb,boolean,uuid) to service_role;
