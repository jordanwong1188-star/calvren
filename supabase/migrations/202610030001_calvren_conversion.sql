-- Calvren reusable conversion MVP. Apply to a dedicated Calvren Supabase project.
-- All database access is through authenticated server functions; no browser DB keys.
begin;
grant usage on schema public to service_role;

create table public.calvren_clients (
  id text primary key check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$'),
  config jsonb not null check (
    jsonb_typeof(config) = 'object' and config ?& array['id','mode','active','business_name'] and config->>'id' = id
    and config->>'mode' in ('demo','live') and jsonb_typeof(config->'active') = 'boolean'
    and length(config->>'business_name') between 1 and 160
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index calvren_clients_live_number on public.calvren_clients ((config->>'phone_number'))
  where config->>'mode' = 'live' and config->>'active' = 'true' and coalesce(config->>'phone_number','') <> '';

create table public.calvren_leads (
  id uuid primary key,
  client_id text not null references public.calvren_clients(id) on delete restrict,
  data jsonb not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  unique (client_id,id),
  check (jsonb_typeof(data) = 'object' and data ?& array['id','client_id','status','mode','channel','version','automation_active','opted_out','consent_sms'] and data->>'id' = id::text and data->>'client_id' = client_id),
  check (data->>'status' in ('new','contacted','responding','qualified','booking','booked','won','lost','needs_human')),
  check (data->>'mode' in ('demo','live') and data->>'channel' in ('sms','website','email')),
  check (jsonb_typeof(data->'automation_active') = 'boolean' and jsonb_typeof(data->'opted_out') = 'boolean'
    and jsonb_typeof(data->'consent_sms') = 'boolean'),
  check ((data->>'version')::integer >= 0),
  check ((lease_token is null) = (lease_expires_at is null))
);
create index calvren_leads_recent on public.calvren_leads (client_id, (data->>'created_at') desc);
create unique index calvren_leads_active_phone on public.calvren_leads (client_id, (data->>'phone'))
  where coalesce(data->>'phone','') <> '' and data->>'status' not in ('won','lost');
create index calvren_leads_due on public.calvren_leads ((data->>'next_follow_up_at'))
  where data->>'automation_active' = 'true' and data->>'opted_out' = 'false'
    and data->>'next_follow_up_at' is not null;

create table public.calvren_messages (
  id uuid primary key,
  client_id text not null,
  lead_id uuid not null,
  data jsonb not null,
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade,
  check (data ?& array['id','client_id','lead_id','status'] and data->>'id' = id::text and data->>'client_id' = client_id and data->>'lead_id' = lead_id::text),
  check (data->>'status' in ('received','pending','sent','failed','unknown')),
  check (data->>'channel' in ('sms','website','email') and data->>'sender' in ('lead','assistant','human','system')),
  check (length(data->>'message') between 1 and 4000),
  check (length(data->>'idempotency_key') between 1 and 200)
);

create unique index calvren_messages_dedupe on public.calvren_messages (client_id,lead_id,(data->>'idempotency_key'));
create index calvren_messages_conversation on public.calvren_messages (client_id,lead_id,(data->>'timestamp'));
create index calvren_messages_provider on public.calvren_messages (client_id,(data->>'provider_id'));

create table public.calvren_appointments (
  id uuid primary key,
  client_id text not null,
  lead_id uuid not null,
  calendar_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 1440),
  data jsonb not null,
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade,
  check (ends_at > starts_at),
  check (data ?& array['id','client_id','lead_id','status'] and data->>'id' = id::text and data->>'client_id' = client_id and data->>'lead_id' = lead_id::text),
  check (data->>'status' in ('pending','booked','failed')),
  check ((data->'slot'->>'start')::timestamptz = starts_at and (data->'slot'->>'end')::timestamptz = ends_at)
);
create index calvren_appointments_calendar on public.calvren_appointments (calendar_key,starts_at,ends_at)
  where data->>'status' in ('pending','booked');
create index calvren_appointments_lead on public.calvren_appointments (client_id,lead_id);

create table public.calvren_notifications (
  id uuid primary key,
  client_id text not null,
  lead_id uuid not null,
  data jsonb not null,
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade,
  check (data ?& array['id','client_id','lead_id','status'] and data->>'id' = id::text and data->>'client_id' = client_id and data->>'lead_id' = lead_id::text),
  check (data->>'status' in ('pending','sent','failed')),
  check (data->>'event' in ('qualified','booked','needs_human','automation_failed'))
);
create index calvren_notifications_lead on public.calvren_notifications (client_id,lead_id);

create table public.calvren_events (
  client_id text not null references public.calvren_clients(id) on delete restrict,
  event_key text not null check (length(event_key) between 1 and 220),
  lead_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (client_id,event_key),
  foreign key (client_id,lead_id) references public.calvren_leads(client_id,id) on delete cascade
);
create table public.calvren_client_keys (
  client_id text primary key references public.calvren_clients(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);
create table public.calvren_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  expires_at timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (key_hash,bucket_start)
);

-- Helpers return one tenant's complete conversation; each relation remains independently inspectable.
create function public.calvren_bundle(p_client_id text,p_lead_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'lead', l.data,
    'messages', coalesce((select jsonb_agg(m.data order by m.data->>'timestamp',m.id)
      from public.calvren_messages m where m.client_id=p_client_id and m.lead_id=p_lead_id),'[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(a.data order by a.data->>'created_at',a.id)
      from public.calvren_appointments a where a.client_id=p_client_id and a.lead_id=p_lead_id),'[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(n.data order by n.data->>'created_at',n.id)
      from public.calvren_notifications n where n.client_id=p_client_id and n.lead_id=p_lead_id),'[]'::jsonb)
  ) from public.calvren_leads l where l.client_id=p_client_id and l.id=p_lead_id;
$$;

-- A caller may omit already stored child rows; they are never deleted during CAS.
-- Existing message content/identity cannot be rewritten by a stale worker.
create function public.calvren_sync_children(p_client_id text,p_lead_id uuid,p_bundle jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; affected integer;
begin
  if jsonb_typeof(p_bundle->'messages') <> 'array'
    or jsonb_typeof(p_bundle->'appointments') <> 'array'
    or jsonb_typeof(p_bundle->'notifications') <> 'array' then
    raise exception 'Invalid conversation bundle' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_bundle->'messages') loop
    if item->>'client_id' is distinct from p_client_id or item->>'lead_id' is distinct from p_lead_id::text then
      raise exception 'Message tenant mismatch' using errcode='22023';
    end if;
    insert into public.calvren_messages(id,client_id,lead_id,data)
      values((item->>'id')::uuid,p_client_id,p_lead_id,item)
      on conflict(id) do update set data = case when public.calvren_messages.data->>'status'='sent' and excluded.data->>'status' in ('pending','unknown')
        then public.calvren_messages.data else public.calvren_messages.data ||
        jsonb_build_object('status',excluded.data->'status','provider_id',case when public.calvren_messages.data->>'provider_id' is not null
          and excluded.data->>'provider_id' is null then public.calvren_messages.data->'provider_id' else excluded.data->'provider_id' end) end
      where public.calvren_messages.client_id=p_client_id and public.calvren_messages.lead_id=p_lead_id
        and public.calvren_messages.data->>'message' = excluded.data->>'message'
        and public.calvren_messages.data->>'idempotency_key' = excluded.data->>'idempotency_key'
        and public.calvren_messages.data->>'sender' = excluded.data->>'sender'
        and public.calvren_messages.data->>'channel' = excluded.data->>'channel'
        and public.calvren_messages.data->>'timestamp' = excluded.data->>'timestamp'
        and (public.calvren_messages.data->>'provider_id' is null or excluded.data->>'provider_id' is null
          or public.calvren_messages.data->>'provider_id' = excluded.data->>'provider_id');
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'Message identity conflict' using errcode='23505'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_bundle->'notifications') loop
    if item->>'client_id' is distinct from p_client_id or item->>'lead_id' is distinct from p_lead_id::text then
      raise exception 'Notification tenant mismatch' using errcode='22023';
    end if;
    insert into public.calvren_notifications(id,client_id,lead_id,data)
      values((item->>'id')::uuid,p_client_id,p_lead_id,item)
      on conflict(id) do update set data=public.calvren_notifications.data ||
        jsonb_build_object('status',excluded.data->'status','provider_id',excluded.data->'provider_id')
      where public.calvren_notifications.client_id=p_client_id and public.calvren_notifications.lead_id=p_lead_id
        and public.calvren_notifications.data->>'event'=excluded.data->>'event';
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'Notification identity conflict' using errcode='23505'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_bundle->'appointments') loop
    if item->>'client_id' is distinct from p_client_id or item->>'lead_id' is distinct from p_lead_id::text then
      raise exception 'Appointment tenant mismatch' using errcode='22023';
    end if;
    update public.calvren_appointments set data=case when data->>'status'='booked' then data else data ||
      jsonb_build_object('status',item->'status','provider_id',item->'provider_id') end
      where id=(item->>'id')::uuid and client_id=p_client_id and lead_id=p_lead_id
        and data->'slot'=item->'slot';
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'Reserve appointment before saving it' using errcode='22023'; end if;
  end loop;
end;
$$;

create function public.calvren_create_lead(p_bundle jsonb,p_idempotency_key text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare client text:=p_bundle->'lead'->>'client_id'; lead_id uuid:=(p_bundle->'lead'->>'id')::uuid;
  existing uuid; phone text:=p_bundle->'lead'->>'phone'; config jsonb;
begin
  if length(p_idempotency_key) not between 1 and 200 then raise exception 'Invalid intake key' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('calvren-intake:'||client||':'||p_idempotency_key,0));
  select e.lead_id into existing from public.calvren_events e
    where e.client_id=client and e.event_key='intake:'||p_idempotency_key;
  if existing is not null then return jsonb_build_object('created',false,'bundle',public.calvren_bundle(client,existing)); end if;
  select c.config into config from public.calvren_clients c where c.id=client for share;
  if config is null or config->>'active'<>'true' or config->>'mode' is distinct from p_bundle->'lead'->>'mode' then
    raise exception 'Client is inactive or mode does not match' using errcode='22023';
  end if;
  if coalesce(phone,'')<>'' then
    perform pg_advisory_xact_lock(hashtextextended('calvren-phone:'||client||':'||phone,0));
    select l.id into existing from public.calvren_leads l where l.client_id=client
      and l.data->>'phone'=phone and l.data->>'status' not in ('won','lost') limit 1 for update;
    if existing is not null then
      insert into public.calvren_events(client_id,event_key,lead_id) values(client,'intake:'||p_idempotency_key,existing);
      return jsonb_build_object('created',false,'bundle',public.calvren_bundle(client,existing));
    end if;
  end if;
  if jsonb_array_length(p_bundle->'appointments')<>0 then raise exception 'New lead has appointments' using errcode='22023'; end if;
  insert into public.calvren_leads(id,client_id,data) values(lead_id,client,p_bundle->'lead');
  perform public.calvren_sync_children(client,lead_id,p_bundle);
  insert into public.calvren_events(client_id,event_key,lead_id) values(client,'intake:'||p_idempotency_key,lead_id);
  return jsonb_build_object('created',true,'bundle',public.calvren_bundle(client,lead_id));
end;
$$;

create function public.calvren_get_bundle(p_client_id text,p_lead_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.calvren_bundle(p_client_id,p_lead_id);
$$;

create function public.calvren_list_leads(p_client_id text default null,p_limit integer default 100) returns setof jsonb
language sql stable security invoker set search_path = '' as $$
  select public.calvren_bundle(l.client_id,l.id) from public.calvren_leads l
    where p_client_id is null or l.client_id=p_client_id
    order by l.data->>'created_at' desc,l.id limit least(greatest(p_limit,1),200);
$$;

create function public.calvren_find_lead_by_phone(p_client_id text,p_phone text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.calvren_bundle(p_client_id,l.id) from public.calvren_leads l
    where l.client_id=p_client_id and l.data->>'phone'=p_phone
    order by (l.data->>'status' not in ('won','lost')) desc,l.data->>'created_at' desc limit 1;
$$;

create function public.calvren_append_inbound(p_client_id text,p_lead_id uuid,p_message jsonb,p_event_key text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare saved jsonb; inserted integer; existing uuid;
begin
  if length(p_event_key) not between 1 and 200 or p_message->>'client_id' is distinct from p_client_id
    or p_message->>'lead_id' is distinct from p_lead_id::text or p_message->>'sender'<>'lead' then
    raise exception 'Invalid inbound message' using errcode='22023';
  end if;
  select l.data into saved from public.calvren_leads l where l.client_id=p_client_id and l.id=p_lead_id for update;
  if saved is null then return null; end if;
  insert into public.calvren_events(client_id,event_key,lead_id)
    values(p_client_id,'inbound:'||p_event_key,p_lead_id) on conflict(client_id,event_key) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then
    select e.lead_id into existing from public.calvren_events e where e.client_id=p_client_id and e.event_key='inbound:'||p_event_key;
    if existing<>p_lead_id then raise exception 'Webhook belongs to another lead' using errcode='23505'; end if;
    return jsonb_build_object('created',false,'bundle',public.calvren_bundle(p_client_id,p_lead_id));
  end if;
  insert into public.calvren_messages(id,client_id,lead_id,data)
    values((p_message->>'id')::uuid,p_client_id,p_lead_id,p_message);
  saved:=saved||jsonb_build_object('version',(saved->>'version')::integer+1,
    'last_inbound_at',p_message->>'timestamp','updated_at',p_message->>'timestamp','next_follow_up_at',null,'follow_up_attempts',0,
    'status',case when saved->>'automation_active'='true' and saved->>'opted_out'='false'
      and saved->>'status' not in ('won','lost','booked') then 'responding' else saved->>'status' end);
  update public.calvren_leads set data=saved,lease_token=null,lease_expires_at=null where client_id=p_client_id and id=p_lead_id;
  -- A pending provider call may already be in flight. Preserve that uncertainty; never auto-retry it.
  update public.calvren_messages set data=data||jsonb_build_object('status','unknown')
    where client_id=p_client_id and lead_id=p_lead_id and data->>'sender'='assistant' and data->>'status'='pending';
  return jsonb_build_object('created',true,'bundle',public.calvren_bundle(p_client_id,p_lead_id));
end;
$$;

create function public.calvren_acquire_lease(p_client_id text,p_lead_id uuid,p_now timestamptz,p_ttl_seconds integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare saved uuid; token uuid:=gen_random_uuid(); expires timestamptz:=p_now+make_interval(secs=>least(greatest(p_ttl_seconds,5),180));
begin
  update public.calvren_leads l set lease_token=token,lease_expires_at=expires
    where l.client_id=p_client_id and l.id=p_lead_id and (l.lease_expires_at is null or l.lease_expires_at<=p_now)
      and exists(select 1 from public.calvren_clients c where c.id=p_client_id and c.config->>'active'='true')
    returning l.id into saved;
  if saved is null then return null; end if;
  return jsonb_build_object('token',token,'expires_at',expires,'bundle',public.calvren_bundle(p_client_id,p_lead_id));
end;
$$;
create function public.calvren_lease_valid(p_client_id text,p_lead_id uuid,p_token uuid,p_version integer,p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.calvren_leads l
    join public.calvren_clients c on c.id=l.client_id
    where l.client_id=p_client_id and l.id=p_lead_id and l.lease_token=p_token
      and l.lease_expires_at>p_now and (l.data->>'version')::integer=p_version
      and c.config->>'active'='true');
$$;
create function public.calvren_save_bundle(p_bundle jsonb,p_token uuid,p_now timestamptz) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare client text:=p_bundle->'lead'->>'client_id'; lead_id uuid:=(p_bundle->'lead'->>'id')::uuid;
  saved jsonb; changed jsonb;
begin
  select l.data into saved from public.calvren_leads l where l.client_id=client and l.id=lead_id
    and l.lease_token=p_token and l.lease_expires_at>p_now
    and (l.data->>'version')::integer=(p_bundle->'lead'->>'version')::integer for update;
  if saved is null then return null; end if;
  if p_bundle->'lead'->>'mode' is distinct from saved->>'mode'
    or p_bundle->'lead'->>'created_at' is distinct from saved->>'created_at'
    or p_bundle->'lead'->>'phone' is distinct from saved->>'phone'
    or p_bundle->'lead'->>'consent_sms' is distinct from saved->>'consent_sms'
    or p_bundle->'lead'->>'opted_out' is distinct from saved->>'opted_out' then
    raise exception 'Immutable lead fields changed' using errcode='22023';
  end if;
  changed:=p_bundle->'lead'||jsonb_build_object('version',(saved->>'version')::integer+1);
  update public.calvren_leads set data=changed where client_id=client and id=lead_id;
  perform public.calvren_sync_children(client,lead_id,p_bundle);
  return public.calvren_bundle(client,lead_id);
end;
$$;
create function public.calvren_release_lease(p_client_id text,p_lead_id uuid,p_token uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.calvren_leads set lease_token=null,lease_expires_at=null
    where client_id=p_client_id and id=p_lead_id and lease_token=p_token;
$$;

create function public.calvren_reserve_appointment(p_bundle jsonb,p_appointment jsonb,p_token uuid,p_now timestamptz) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare client text:=p_bundle->'lead'->>'client_id'; lead_id uuid:=(p_bundle->'lead'->>'id')::uuid;
  appointment_id uuid:=(p_appointment->>'id')::uuid; saved jsonb; config jsonb; calendar text;
  starts timestamptz:=(p_appointment->'slot'->>'start')::timestamptz;
  ends timestamptz:=(p_appointment->'slot'->>'end')::timestamptz; buffer integer; existing jsonb; result jsonb;
begin
  if p_appointment->>'client_id' is distinct from client or p_appointment->>'lead_id' is distinct from lead_id::text
    or p_appointment->>'status'<>'pending' or starts<=p_now or ends<=starts then
    raise exception 'Invalid appointment reservation' using errcode='22023';
  end if;
  select l.data into saved from public.calvren_leads l where l.client_id=client and l.id=lead_id
    and l.lease_token=p_token and l.lease_expires_at>p_now
    and (l.data->>'version')::integer=(p_bundle->'lead'->>'version')::integer
    and l.data->>'automation_active'='true' and l.data->>'opted_out'='false' for update;
  if saved is null then return null; end if;
  select c.config into config from public.calvren_clients c where c.id=client and c.config->>'active'='true' for share;
  if config is null or config->>'booking_enabled'<>'true' then return null; end if;
  calendar:=(config->'calendar'->>'provider')||':'||(config->'calendar'->>'calendar_id');
  if config->>'mode'='demo' then calendar:='demo:'||client||':'||calendar; end if;
  buffer:=least(greatest((config->'calendar'->>'buffer_minutes')::integer,0),1440);
  if calendar is null or calendar='' then raise exception 'Calendar is missing' using errcode='22023'; end if;
  -- Physical calendar lock, not just client: protects two tenants sharing a calendar.
  perform pg_advisory_xact_lock(hashtextextended('calvren-calendar:'||calendar,0));
  select a.data into existing from public.calvren_appointments a where a.id=appointment_id;
  if existing is not null and (existing->>'client_id' is distinct from client
    or existing->>'lead_id' is distinct from lead_id::text or existing->'slot' is distinct from p_appointment->'slot') then
    raise exception 'Appointment identity conflict' using errcode='23505';
  end if;
  if exists(select 1 from public.calvren_appointments a where a.calendar_key=calendar and a.id<>appointment_id
    and a.data->>'status' in ('pending','booked')
    and a.starts_at<ends+make_interval(mins=>greatest(buffer,a.buffer_minutes))
    and a.ends_at+make_interval(mins=>greatest(buffer,a.buffer_minutes))>starts) then return null; end if;
  insert into public.calvren_appointments(id,client_id,lead_id,calendar_key,starts_at,ends_at,buffer_minutes,data)
    values(appointment_id,client,lead_id,calendar,starts,ends,buffer,p_appointment)
    on conflict(id) do update set data=case when public.calvren_appointments.data->>'status'='booked'
      then public.calvren_appointments.data else excluded.data end;
  result:=public.calvren_save_bundle(jsonb_set(p_bundle,'{lead,appointment_status}','"pending"'::jsonb),p_token,p_now);
  if result is null then raise exception 'Lead changed during reservation' using errcode='40001'; end if;
  return result;
end;
$$;

create function public.calvren_due_follow_ups(p_now timestamptz,p_limit integer) returns table(client_id text,lead_id uuid)
language sql stable security invoker set search_path = '' as $$
  select l.client_id,l.id from public.calvren_leads l join public.calvren_clients c on c.id=l.client_id
    where c.config->>'active'='true' and c.config->>'follow_up_enabled'='true'
      and l.data->>'automation_active'='true' and l.data->>'opted_out'='false'
      and l.data->>'status' not in ('won','lost','booked','needs_human')
      and l.data->>'next_follow_up_at' is not null
      and (l.data->>'next_follow_up_at')::timestamptz<=p_now
      and (l.data->>'follow_up_attempts')::integer<(c.config->>'max_follow_up_attempts')::integer
      and (l.lease_expires_at is null or l.lease_expires_at<=p_now)
    order by l.data->>'next_follow_up_at',l.id limit least(greatest(p_limit,1),100);
$$;

create function public.calvren_force_handoff(p_client_id text,p_lead_id uuid,p_reason text,p_now timestamptz,p_opted_out boolean default false) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare saved jsonb;
begin
  select l.data into saved from public.calvren_leads l where l.client_id=p_client_id and l.id=p_lead_id for update;
  if saved is null then return null; end if;
  update public.calvren_leads set data=saved||jsonb_build_object(
    'status','needs_human','automation_active',false,'next_follow_up_at',null,
    'handoff_reason',left(p_reason,500),'opted_out',(saved->>'opted_out')::boolean or p_opted_out,
    'consent_sms',(saved->>'consent_sms')::boolean and not p_opted_out,
    'updated_at',p_now,'version',(saved->>'version')::integer+1),lease_token=null,lease_expires_at=null
    where client_id=p_client_id and id=p_lead_id;
  update public.calvren_messages set data=data||jsonb_build_object('status','unknown')
    where client_id=p_client_id and lead_id=p_lead_id and data->>'sender'='assistant' and data->>'status'='pending';
  return public.calvren_bundle(p_client_id,p_lead_id);
end;
$$;
create function public.calvren_resume_lead(p_client_id text,p_lead_id uuid,p_now timestamptz) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare saved jsonb;
begin
  select l.data into saved from public.calvren_leads l
    where l.client_id=p_client_id and l.id=p_lead_id and l.data->>'opted_out'='false'
      and l.data->>'status' not in ('won','lost','booked')
      and (l.data->>'channel'<>'sms' or l.data->>'consent_sms'='true')
      and not exists(select 1 from public.calvren_appointments a where a.client_id=p_client_id and a.lead_id=p_lead_id
        and a.data->>'status'='pending')
      and not exists(select 1 from public.calvren_messages m where m.client_id=p_client_id and m.lead_id=p_lead_id
        and m.data->>'sender'='assistant' and m.data->>'status' in ('pending','unknown'))
      and exists(select 1 from public.calvren_clients c where c.id=p_client_id and c.config->>'active'='true') for update;
  if saved is null then return null; end if;
  update public.calvren_leads set data=saved||jsonb_build_object('status','responding','automation_active',true,
    'handoff_reason',null,'next_follow_up_at',null,'updated_at',p_now,'version',(saved->>'version')::integer+1),
    lease_token=null,lease_expires_at=null where client_id=p_client_id and id=p_lead_id;
  return public.calvren_bundle(p_client_id,p_lead_id);
end;
$$;

create function public.calvren_save_client(p_client jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare saved jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('calvren-client:'||(p_client->>'id'),0));
  select c.config into saved from public.calvren_clients c where c.id=p_client->>'id' for update;
  if saved is not null and saved->>'mode' is distinct from p_client->>'mode'
    and exists(select 1 from public.calvren_leads l where l.client_id=p_client->>'id') then
    raise exception 'Existing client mode is immutable; create a separate live client' using errcode='22023';
  end if;
  insert into public.calvren_clients(id,config) values(p_client->>'id',p_client)
    on conflict(id) do update set config=excluded.config,updated_at=now();
  return p_client;
end;
$$;

create function public.calvren_consume_rate_limit(p_key_hash text,p_limit integer,p_window_seconds integer,p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare starts timestamptz; hits integer; duration integer:=least(greatest(p_window_seconds,1),86400);
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' or p_limit not between 1 and 10000 then
    raise exception 'Invalid rate limit' using errcode='22023';
  end if;
  starts:=to_timestamp(floor(extract(epoch from p_now)/duration)*duration);
  insert into public.calvren_rate_limits(key_hash,bucket_start,expires_at,hits)
    values(p_key_hash,starts,starts+make_interval(secs=>duration),1)
    on conflict(key_hash,bucket_start) do update set hits=public.calvren_rate_limits.hits+1
      where public.calvren_rate_limits.hits<p_limit returning public.calvren_rate_limits.hits into hits;
  delete from public.calvren_rate_limits where (key_hash,bucket_start) in (
    select r.key_hash,r.bucket_start from public.calvren_rate_limits r where r.expires_at<p_now-interval '1 day' limit 100);
  return hits is not null;
end;
$$;
create function public.calvren_verify_client_key(p_client_id text,p_key_hash text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.calvren_client_keys k join public.calvren_clients c on c.id=k.client_id
    where k.client_id=p_client_id and k.key_hash=p_key_hash and c.config->>'active'='true');
$$;
create function public.calvren_rotate_client_key(p_client_id text,p_key_hash text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_key_hash is null then delete from public.calvren_client_keys where client_id=p_client_id; return; end if;
  insert into public.calvren_client_keys(client_id,key_hash) values(p_client_id,p_key_hash)
    on conflict(client_id) do update set key_hash=excluded.key_hash,updated_at=now();
end;
$$;

create function public.calvren_update_message_status(p_client_id text,p_lead_id uuid,p_provider_id text,p_status text,p_event_key text,p_message_id uuid default null) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare saved jsonb; inserted integer; affected integer; message_id uuid; message_data jsonb;
begin
  if p_status not in ('sent','failed','unknown') or length(p_event_key) not between 1 and 200
    or length(p_provider_id) not between 1 and 200 then
    raise exception 'Invalid delivery status' using errcode='22023';
  end if;
  select l.data into saved from public.calvren_leads l where l.client_id=p_client_id and l.id=p_lead_id for update;
  if saved is null then return false; end if;
  select m.id,m.data into message_id,message_data from public.calvren_messages m
    where m.client_id=p_client_id and m.lead_id=p_lead_id and m.data->>'sender'='assistant'
      and m.data->>'channel'='sms' and (
        (p_message_id is null and m.data->>'provider_id'=p_provider_id)
        or (p_message_id=m.id and (
          m.data->>'provider_id'=p_provider_id
          or (m.data->>'provider_id' is null and m.data->>'status' in ('pending','unknown'))
        ))
      ) limit 1 for update;
  if message_id is null then return false; end if;
  insert into public.calvren_events(client_id,event_key,lead_id)
    values(p_client_id,'status:'||p_event_key,p_lead_id) on conflict(client_id,event_key) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return false; end if;
  update public.calvren_messages set data=data||jsonb_build_object('status',p_status,'provider_id',p_provider_id)
    where id=message_id and client_id=p_client_id and lead_id=p_lead_id;
  get diagnostics affected=row_count;
  -- Accepted/delivered callbacks can arrive before send() returns. Keep that worker's
  -- lease/version so it can finish contact/follow-up/booking notification side effects.
  -- sync_children preserves confirmed metadata against pending/unknown snapshots.
  if p_status='failed' then
    saved:=saved||jsonb_build_object('version',(saved->>'version')::integer+1,
      'status','needs_human','automation_active',false,'next_follow_up_at',null,
      'handoff_reason','SMS delivery failed; review the conversation before resuming.');
    update public.calvren_leads set data=saved,lease_token=null,lease_expires_at=null
      where client_id=p_client_id and id=p_lead_id;
  end if;
  return affected>0;
end;
$$;

-- Deny direct browser access, including authenticated Supabase users.
alter table public.calvren_clients enable row level security;
revoke all on table public.calvren_clients from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_clients to service_role;
alter table public.calvren_leads enable row level security;
revoke all on table public.calvren_leads from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_leads to service_role;
alter table public.calvren_messages enable row level security;
revoke all on table public.calvren_messages from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_messages to service_role;
alter table public.calvren_appointments enable row level security;
revoke all on table public.calvren_appointments from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_appointments to service_role;
alter table public.calvren_notifications enable row level security;
revoke all on table public.calvren_notifications from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_notifications to service_role;
alter table public.calvren_events enable row level security;
revoke all on table public.calvren_events from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_events to service_role;
alter table public.calvren_client_keys enable row level security;
revoke all on table public.calvren_client_keys from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_client_keys to service_role;
alter table public.calvren_rate_limits enable row level security;
revoke all on table public.calvren_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on table public.calvren_rate_limits to service_role;
revoke execute on function public.calvren_bundle(text,uuid) from public,anon,authenticated;
grant execute on function public.calvren_bundle(text,uuid) to service_role;
revoke execute on function public.calvren_sync_children(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.calvren_sync_children(text,uuid,jsonb) to service_role;
revoke execute on function public.calvren_create_lead(jsonb,text) from public,anon,authenticated;
grant execute on function public.calvren_create_lead(jsonb,text) to service_role;
revoke execute on function public.calvren_get_bundle(text,uuid) from public,anon,authenticated;
grant execute on function public.calvren_get_bundle(text,uuid) to service_role;
revoke execute on function public.calvren_list_leads(text,integer) from public,anon,authenticated;
grant execute on function public.calvren_list_leads(text,integer) to service_role;
revoke execute on function public.calvren_find_lead_by_phone(text,text) from public,anon,authenticated;
grant execute on function public.calvren_find_lead_by_phone(text,text) to service_role;
revoke execute on function public.calvren_append_inbound(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.calvren_append_inbound(text,uuid,jsonb,text) to service_role;
revoke execute on function public.calvren_acquire_lease(text,uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.calvren_acquire_lease(text,uuid,timestamptz,integer) to service_role;
revoke execute on function public.calvren_lease_valid(text,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_lease_valid(text,uuid,uuid,integer,timestamptz) to service_role;
revoke execute on function public.calvren_save_bundle(jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_save_bundle(jsonb,uuid,timestamptz) to service_role;
revoke execute on function public.calvren_release_lease(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.calvren_release_lease(text,uuid,uuid) to service_role;
revoke execute on function public.calvren_reserve_appointment(jsonb,jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_reserve_appointment(jsonb,jsonb,uuid,timestamptz) to service_role;
revoke execute on function public.calvren_due_follow_ups(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.calvren_due_follow_ups(timestamptz,integer) to service_role;
revoke execute on function public.calvren_force_handoff(text,uuid,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.calvren_force_handoff(text,uuid,text,timestamptz,boolean) to service_role;
revoke execute on function public.calvren_resume_lead(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_resume_lead(text,uuid,timestamptz) to service_role;
revoke execute on function public.calvren_save_client(jsonb) from public,anon,authenticated;
grant execute on function public.calvren_save_client(jsonb) to service_role;
revoke execute on function public.calvren_consume_rate_limit(text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.calvren_consume_rate_limit(text,integer,integer,timestamptz) to service_role;
revoke execute on function public.calvren_verify_client_key(text,text) from public,anon,authenticated;
grant execute on function public.calvren_verify_client_key(text,text) to service_role;
revoke execute on function public.calvren_rotate_client_key(text,text) from public,anon,authenticated;
grant execute on function public.calvren_rotate_client_key(text,text) to service_role;
revoke execute on function public.calvren_update_message_status(text,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.calvren_update_message_status(text,uuid,text,text,text,uuid) to service_role;

commit;
