-- Retell AI voice receptionist foundation. Nothing is activated by this migration.
begin;
create table if not exists public.calvren_receptionist_configs (
  client_id text primary key references public.calvren_clients(id) on delete cascade,
  retell_agent_id text not null unique check (retell_agent_id ~ '^[a-zA-Z0-9_-]{5,120}$'),
  retell_phone_number text not null unique check (retell_phone_number ~ '^[+][1-9][0-9]{7,14}),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.calvren_receptionist_calls (
  call_id text primary key check (call_id ~ '^[a-zA-Z0-9_-]{5,120}$'),
  client_id text not null references public.calvren_clients(id) on delete restrict,
  agent_id text not null,
  event_rank smallint not null check (event_rank between 1 and 3),
  last_event text not null check (last_event in ('call_started','call_ended','call_analyzed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calvren_receptionist_calls_client_updated
  on public.calvren_receptionist_calls(client_id,updated_at desc);
alter table public.calvren_receptionist_configs enable row level security;
alter table public.calvren_receptionist_calls enable row level security;
revoke all on table public.calvren_receptionist_configs, public.calvren_receptionist_calls from public,anon,authenticated;
grant select,insert,update on table public.calvren_receptionist_configs, public.calvren_receptionist_calls to service_role;
-- Atomic, monotonic event transitions make webhook retries and reordering harmless.
create or replace function public.calvren_receptionist_record_event(
  p_client_id text,p_call_id text,p_agent_id text,p_event text,
  p_started_at timestamptz default null,p_ended_at timestamptz default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare r smallint;
begin
  r := case p_event when 'call_started' then 1 when 'call_ended' then 2 when 'call_analyzed' then 3 else 0 end;
  if r=0 or p_call_id !~ '^[a-zA-Z0-9_-]{5,120}$' then
    raise exception 'Invalid voice event' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.calvren_receptionist_configs v
    join public.calvren_clients c on c.id=v.client_id
    where v.client_id=p_client_id and v.retell_agent_id=p_agent_id and v.enabled=true
      and c.config->>'mode'='live' and c.config->>'active'='true'
  ) then raise exception 'Inactive voice client' using errcode='42501'; end if;
  insert into public.calvren_receptionist_calls(call_id,client_id,agent_id,event_rank,last_event,started_at,ended_at)
    values(p_call_id,p_client_id,p_agent_id,r,p_event,p_started_at,p_ended_at)
  on conflict(call_id) do update
    set event_rank=greatest(public.calvren_receptionist_calls.event_rank,excluded.event_rank),
        last_event=case when excluded.event_rank>=public.calvren_receptionist_calls.event_rank then excluded.last_event else public.calvren_receptionist_calls.last_event end,
        started_at=coalesce(public.calvren_receptionist_calls.started_at,excluded.started_at),
        ended_at=coalesce(public.calvren_receptionist_calls.ended_at,excluded.ended_at),
        updated_at=now()
    where public.calvren_receptionist_calls.client_id=excluded.client_id
      and public.calvren_receptionist_calls.agent_id=excluded.agent_id;
  if not found then raise exception 'Call identity mismatch' using errcode='23505'; end if;
end $$;
revoke all on function public.calvren_receptionist_record_event(text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_receptionist_record_event(text,text,text,text,timestamptz,timestamptz) to service_role;
commit;
),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.calvren_receptionist_calls (
  call_id text primary key check (call_id ~ '^[a-zA-Z0-9_-]{5,120}$'),
  client_id text not null references public.calvren_clients(id) on delete restrict,
  agent_id text not null,
  event_rank smallint not null check (event_rank between 1 and 3),
  last_event text not null check (last_event in ('call_started','call_ended','call_analyzed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calvren_receptionist_calls_client_updated
  on public.calvren_receptionist_calls(client_id,updated_at desc);
alter table public.calvren_receptionist_configs enable row level security;
alter table public.calvren_receptionist_calls enable row level security;
revoke all on table public.calvren_receptionist_configs, public.calvren_receptionist_calls from public,anon,authenticated;
grant select,insert,update on table public.calvren_receptionist_configs, public.calvren_receptionist_calls to service_role;
-- Atomic, monotonic event transitions make webhook retries and reordering harmless.
create or replace function public.calvren_receptionist_record_event(
  p_client_id text,p_call_id text,p_agent_id text,p_event text,
  p_started_at timestamptz default null,p_ended_at timestamptz default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare r smallint;
begin
  r := case p_event when 'call_started' then 1 when 'call_ended' then 2 when 'call_analyzed' then 3 else 0 end;
  if r=0 or p_call_id !~ '^[a-zA-Z0-9_-]{5,120}$' then
    raise exception 'Invalid voice event' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.calvren_receptionist_configs v
    join public.calvren_clients c on c.id=v.client_id
    where v.client_id=p_client_id and v.retell_agent_id=p_agent_id and v.enabled=true
      and c.config->>'mode'='live' and c.config->>'active'='true'
  ) then raise exception 'Inactive voice client' using errcode='42501'; end if;
  insert into public.calvren_receptionist_calls(call_id,client_id,agent_id,event_rank,last_event,started_at,ended_at)
    values(p_call_id,p_client_id,p_agent_id,r,p_event,p_started_at,p_ended_at)
  on conflict(call_id) do update
    set event_rank=greatest(public.calvren_receptionist_calls.event_rank,excluded.event_rank),
        last_event=case when excluded.event_rank>=public.calvren_receptionist_calls.event_rank then excluded.last_event else public.calvren_receptionist_calls.last_event end,
        started_at=coalesce(public.calvren_receptionist_calls.started_at,excluded.started_at),
        ended_at=coalesce(public.calvren_receptionist_calls.ended_at,excluded.ended_at),
        updated_at=now()
    where public.calvren_receptionist_calls.client_id=excluded.client_id
      and public.calvren_receptionist_calls.agent_id=excluded.agent_id;
  if not found then raise exception 'Call identity mismatch' using errcode='23505'; end if;
end $$;
revoke all on function public.calvren_receptionist_record_event(text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_receptionist_record_event(text,text,text,text,timestamptz,timestamptz) to service_role;
commit;
