-- Calvren cron jobs without storing or transmitting raw long-lived bearer tokens.
-- Requires pg_cron, pg_net and Supabase Vault, installed in this project.
begin;
do $inner$
begin
  if not exists (select 1 from vault.secrets where name='calvren_dispatch_hmac') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
      'calvren_dispatch_hmac','Dedicated HMAC secret for signed Calvren background job dispatch');
  end if;
end
$inner$;

create or replace function public.calvren_verify_dispatch_signature(
  p_route text,p_timestamp text,p_sig text
) returns boolean
language plpgsql volatile security definer set search_path=''
as $verify$
declare secret_value text; expected text;
begin
  if p_route is null or p_route not in ('follow-ups','hub-scheduler') or
    p_timestamp is null or p_timestamp !~ '^[0-9]{10}$' or
    p_sig is null or p_sig !~ '^[a-f0-9]{64}$' then return false; end if;
  if abs(extract(epoch from clock_timestamp())-p_timestamp::numeric)>90 then return false; end if;
  select decrypted_secret into secret_value
    from vault.decrypted_secrets where name='calvren_dispatch_hmac' limit 1;
  if secret_value is null or length(secret_value)<32 then return false; end if;
  expected:=encode(extensions.hmac(p_timestamp||'.'||p_route,secret_value,'sha256'),'hex');
  return expected=p_sig;
end
$verify$;
revoke all on function public.calvren_verify_dispatch_signature(text,text,text) from public,anon,authenticated;
grant execute on function public.calvren_verify_dispatch_signature(text,text,text) to service_role;

create or replace function public.calvren_emit_dispatch(p_route text) returns bigint
language plpgsql volatile security definer set search_path=''
as $send$
declare secret_value text;stamp text; signature text; req bigint;
begin
  if p_route is null or p_route not in ('follow-ups','hub-scheduler') then
    raise exception 'Unknown scheduled action';
  end if;
  select decrypted_secret into secret_value
    from vault.decrypted_secrets where name='calvren_dispatch_hmac' limit 1;
  if secret_value is null or length(secret_value)<32 then
    raise exception 'Scheduled action signing key unavailable';
  end if;
  stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature:=encode(extensions.hmac(stamp||'.'||p_route,secret_value,'sha256'),'hex');
  select net.http_post(
    url:='https://xjfsukhfmkgvlfpgjevg.supabase.co/functions/v1/calvren/api/internal/'||p_route,
    body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json',
      'X-Calvren-Timestamp',stamp,'X-Calvren-Signature',signature),
    timeout_milliseconds:=60000
  ) into req;
  return req;
end
$send$;
revoke all on function public.calvren_emit_dispatch(text) from public,anon,authenticated;
-- Job executes as postgres; do not grant service_role unnecessary ability to invoke.
-- Named jobs update existing schedules when this migration is applied again.
select cron.schedule('calvren-native-followups','*/5 * * * *',
  $select public.calvren_emit_dispatch('follow-ups');$);
select cron.schedule('calvren-native-hub-daily','19 13 * * *',
  $select public.calvren_emit_dispatch('hub-scheduler');$);
commit;
