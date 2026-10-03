-- Run after the migration against disposable PostgreSQL 16.
-- Fixture prerequisite: roles anon, authenticated, service_role (BYPASSRLS).
-- No provider calls, no real customer data. This transaction rolls every fixture back.
begin;
do $$
begin
  if has_table_privilege('anon','public.calvren_leads','SELECT') or
     has_table_privilege('authenticated','public.calvren_clients','SELECT') or
     has_function_privilege('anon','public.calvren_create_lead(jsonb,text)','EXECUTE') or
     has_function_privilege('authenticated','public.calvren_force_handoff(text,uuid,text,timestamptz,boolean)','EXECUTE') then
    raise exception 'Browser roles gained access to private automation data/functions';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.calvren_leads'::regclass) then
    raise exception 'RLS is disabled';
  end if;
end;
$$;
set local role service_role;

do $$
declare
  client_a text:='sql-test-a'; client_b text:='sql-test-b';
  lead_a uuid:=gen_random_uuid(); lead_b uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  initial_message uuid:=gen_random_uuid(); incoming_message uuid:=gen_random_uuid(); outbound_message uuid:=gen_random_uuid();
  appointment_a uuid:=gen_random_uuid(); appointment_b uuid:=gen_random_uuid();
  config jsonb; config_b jsonb; base_lead jsonb; bundle jsonb; bundle_b jsonb; result jsonb; result_b jsonb;
  lease jsonb; lease_b jsonb; stale jsonb; inbound jsonb; outbound jsonb; appointment jsonb; wrong jsonb;
  fixed_now timestamptz:='2030-01-02T10:00:00Z';
  due_count integer; changed boolean; digest text:=repeat('a',64);
begin
  config:=jsonb_build_object(
    'id',client_a,'business_name','Synthetic SQL Client A','industry','Local services',
    'description','Disposable test business','services',jsonb_build_array('Leak repair'),
    'phone_number','+15555550101','email','owner@example.com','timezone','UTC',
    'business_hours',jsonb_build_object('3',jsonb_build_object('open','08:00','close','17:00')),
    'ai_tone','Professional','system_prompt','Test only',
    'qualifying_questions',jsonb_build_array(jsonb_build_object('id','service','prompt','What service?','required',true)),
    'booking_enabled',true,'follow_up_enabled',true,'follow_up_delay',jsonb_build_array(120,1440),
    'max_follow_up_attempts',3,'notification_email','owner@example.com',
    'calendar',jsonb_build_object('provider','google','calendar_id','synthetic-shared-calendar','duration_minutes',60,
      'horizon_days',14,'buffer_minutes',15),'booking_rules','Test only','service_areas','[]'::jsonb,'active',true,'mode','live');
  config_b:=config||jsonb_build_object('id',client_b,'business_name','Synthetic SQL Client B','phone_number','+15555550102');
  perform public.calvren_save_client(config);
  perform public.calvren_save_client(config_b);
  base_lead:=jsonb_build_object(
    'id',lead_a,'client_id',client_a,'name','Fake Jordan','phone','+15555550201','email','fake@example.com',
    'original_message','My sink is leaking.','source','sql-test','created_at',fixed_now,'updated_at',fixed_now,
    'status','new','qualification_status','pending','appointment_status','none',
    'last_contacted_at',null,'last_inbound_at',fixed_now,'next_follow_up_at',null,'follow_up_attempts',0,
    'answers','{}'::jsonb,'offered_slots','[]'::jsonb,'automation_active',true,'consent_sms',true,
    'opted_out',false,'mode','live','channel','sms','version',0,'handoff_reason',null);
  inbound:=jsonb_build_object('id',initial_message,'lead_id',lead_a,'client_id',client_a,
    'sender','lead','message','My sink is leaking.','channel','sms','timestamp',fixed_now,
    'ai',false,'status','received','provider_id',null,'idempotency_key','initial-message');
  bundle:=jsonb_build_object('lead',base_lead,'messages',jsonb_build_array(inbound),
    'appointments','[]'::jsonb,'notifications','[]'::jsonb);
  result:=public.calvren_create_lead(bundle,'first-intake');
  if result->>'created'<>'true' or jsonb_array_length(result->'bundle'->'messages')<>1 then
    raise exception 'Atomic lead creation failed';
  end if;
  if public.calvren_create_lead(bundle,'first-intake')->>'created'<>'false' then
    raise exception 'Duplicate intake was not deduped';
  end if;
  wrong:=jsonb_set(bundle,'{lead,id}',to_jsonb(other_id::text));
  wrong:=jsonb_set(wrong,'{messages}','[]'::jsonb);
  result_b:=public.calvren_create_lead(wrong,'different-key-same-phone');
  if result_b->>'created'<>'false' or result_b->'bundle'->'lead'->>'id'<>lead_a::text then
    raise exception 'Active phone uniqueness failed';
  end if;
  if public.calvren_get_bundle(client_b,lead_a) is not null then raise exception 'Tenant isolation failed'; end if;

  lease:=public.calvren_acquire_lease(client_a,lead_a,fixed_now,90);
  if lease is null or not public.calvren_lease_valid(client_a,lead_a,(lease->>'token')::uuid,0,fixed_now) then
    raise exception 'Lease acquisition failed';
  end if;
  if public.calvren_acquire_lease(client_a,lead_a,fixed_now,90) is not null then
    raise exception 'Two workers acquired one lead';
  end if;
  stale:=lease->'bundle';
  inbound:=inbound||jsonb_build_object('id',incoming_message,'message','It can wait.','timestamp',fixed_now+interval '10 seconds',
    'idempotency_key','reply-one');
  result:=public.calvren_append_inbound(client_a,lead_a,inbound,'reply-event');
  if result->>'created'<>'true' or (result->'bundle'->'lead'->>'version')::integer<>1 then
    raise exception 'Inbound was not stored/versioned';
  end if;
  if public.calvren_lease_valid(client_a,lead_a,(lease->>'token')::uuid,0,fixed_now) or
    public.calvren_save_bundle(stale,(lease->>'token')::uuid,fixed_now) is not null then
    raise exception 'Stale worker survived inbound';
  end if;
  if public.calvren_append_inbound(client_a,lead_a,inbound,'reply-event')->>'created'<>'false' then
    raise exception 'Duplicate inbound was not deduped';
  end if;

  lease:=public.calvren_acquire_lease(client_a,lead_a,fixed_now+interval '10 seconds',90);
  bundle:=lease->'bundle';
  outbound:=jsonb_build_object('id',outbound_message,'lead_id',lead_a,'client_id',client_a,'sender','assistant',
    'message','What area are you located in?','channel','sms','timestamp',fixed_now+interval '10 seconds',
    'ai',true,'status','pending','provider_id',null,'idempotency_key','outbound-one');
  -- Omit old rows: saving must preserve already stored messages.
  bundle:=jsonb_set(bundle,'{messages}',jsonb_build_array(outbound));
  result:=public.calvren_save_bundle(bundle,(lease->>'token')::uuid,fixed_now+interval '10 seconds');
  if result is null or jsonb_array_length(result->'messages')<>3 then
    raise exception 'CAS dropped existing messages';
  end if;
  wrong:=jsonb_set(result,'{messages,0,client_id}',to_jsonb(client_b));
  begin
    perform public.calvren_save_bundle(wrong,(lease->>'token')::uuid,fixed_now+interval '10 seconds');
    raise exception 'Cross-tenant child unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
  if not public.calvren_update_message_status(client_a,lead_a,'SM-synthetic','sent','status-event',outbound_message) then
    raise exception 'Callback could not reconcile a pending message';
  end if;
  if public.calvren_update_message_status(client_a,lead_a,'SM-other','sent','wrong-provider',outbound_message) then
    raise exception 'Callback overwrote an unrelated provider ID';
  end if;
  if public.calvren_update_message_status(client_a,lead_a,'SM-synthetic','sent','status-event',outbound_message) then
    raise exception 'Duplicate status event updated twice';
  end if;
  if not public.calvren_lease_valid(client_a,lead_a,(lease->>'token')::uuid,2,fixed_now+interval '11 seconds') then
    raise exception 'Early successful callback interrupted its owning worker';
  end if;
  bundle:=result;
  bundle:=jsonb_set(bundle,'{lead,last_contacted_at}',to_jsonb(fixed_now+interval '15 seconds'));
  bundle:=jsonb_set(bundle,'{lead,next_follow_up_at}',to_jsonb(fixed_now+interval '2 hours'));
  -- A stale pending/unknown snapshot must not drop the callback's confirmed status/SID.
  result:=public.calvren_save_bundle(bundle,(lease->>'token')::uuid,fixed_now+interval '15 seconds');
  if result is null or result->'lead'->>'last_contacted_at' is null or result->'lead'->>'next_follow_up_at' is null then
    raise exception 'Worker could not complete contact/follow-up after early callback';
  end if;
  if not exists(select 1 from public.calvren_messages m where m.id=outbound_message and m.client_id=client_a
    and m.data->>'status'='sent' and m.data->>'provider_id'='SM-synthetic') then
    raise exception 'Pending worker snapshot erased successful callback metadata';
  end if;
  perform public.calvren_release_lease(client_a,lead_a,(lease->>'token')::uuid);

  -- Reserve Client A's appointment, then attempt an overlapping booking for Client B.
  lease:=public.calvren_acquire_lease(client_a,lead_a,fixed_now+interval '20 seconds',90);
  bundle:=lease->'bundle';
  appointment:=jsonb_build_object('id',appointment_a,'lead_id',lead_a,'client_id',client_a,
    'slot',jsonb_build_object('id','slot-a','start','2030-01-02T12:00:00Z','end','2030-01-02T13:00:00Z','label','Noon'),
    'status','pending','provider_id',null,'created_at',fixed_now);
  bundle:=jsonb_set(bundle,'{appointments}',jsonb_build_array(appointment));
  result:=public.calvren_reserve_appointment(bundle,appointment,(lease->>'token')::uuid,fixed_now+interval '20 seconds');
  if result is null or jsonb_array_length(result->'appointments')<>1 or result->'lead'->>'appointment_status'<>'pending' then
    raise exception 'Appointment reservation failed';
  end if;
  if public.calvren_get_bundle(client_b,lead_a) is not null then raise exception 'Booking leaked across tenants'; end if;
  base_lead:=base_lead||jsonb_build_object('id',lead_b,'client_id',client_b,'phone','+15555550202',
    'next_follow_up_at',fixed_now-interval '1 hour','status','qualified');
  inbound:=inbound||jsonb_build_object('id',gen_random_uuid(),'lead_id',lead_b,'client_id',client_b,'idempotency_key','initial-b');
  bundle_b:=jsonb_build_object('lead',base_lead,'messages',jsonb_build_array(inbound),
    'appointments','[]'::jsonb,'notifications','[]'::jsonb);
  perform public.calvren_create_lead(bundle_b,'intake-b');
  lease_b:=public.calvren_acquire_lease(client_b,lead_b,fixed_now+interval '20 seconds',90);
  bundle_b:=lease_b->'bundle';
  appointment:=appointment||jsonb_build_object('id',appointment_b,'lead_id',lead_b,'client_id',client_b,
    'slot',jsonb_build_object('id','slot-b','start','2030-01-02T13:05:00Z','end','2030-01-02T14:05:00Z','label','Buffer overlap'));
  bundle_b:=jsonb_set(bundle_b,'{appointments}',jsonb_build_array(appointment));
  if public.calvren_reserve_appointment(bundle_b,appointment,(lease_b->>'token')::uuid,fixed_now+interval '20 seconds') is not null then
    raise exception 'Two clients reserved an overlapping physical calendar/buffer';
  end if;
  if jsonb_array_length(public.calvren_get_bundle(client_b,lead_b)->'appointments')<>0 then
    raise exception 'Rejected booking persisted a partial reservation';
  end if;
  appointment:=jsonb_set(appointment,'{slot}',jsonb_build_object('id','slot-b-later','start','2030-01-02T14:00:00Z',
    'end','2030-01-02T15:00:00Z','label','Later'));
  bundle_b:=jsonb_set(bundle_b,'{appointments}',jsonb_build_array(appointment));
  result_b:=public.calvren_reserve_appointment(bundle_b,appointment,(lease_b->>'token')::uuid,fixed_now+interval '20 seconds');
  if result_b is null then raise exception 'Non-overlapping booking rejected'; end if;
  perform public.calvren_release_lease(client_b,lead_b,(lease_b->>'token')::uuid);
  select count(*) into due_count from public.calvren_due_follow_ups(fixed_now+interval '30 seconds',1);
  if due_count<>1 then raise exception 'Due follow-up not found/bounded'; end if;

  -- Handoff/STOP invalidates workers, suppresses follow-ups and cannot silently resume.
  result:=public.calvren_force_handoff(client_a,lead_a,'Customer requested STOP',fixed_now+interval '30 seconds',true);
  if result->'lead'->>'status'<>'needs_human' or result->'lead'->>'automation_active'<>'false' or
    result->'lead'->>'opted_out'<>'true' or result->'lead'->>'consent_sms'<>'false' then raise exception 'STOP handoff failed'; end if;
  if public.calvren_lease_valid(client_a,lead_a,(lease->>'token')::uuid,
    (result->'lead'->>'version')::integer,fixed_now+interval '30 seconds') then
    raise exception 'Handoff did not invalidate worker';
  end if;
  if public.calvren_resume_lead(client_a,lead_a,fixed_now+interval '31 seconds') is not null then
    raise exception 'Opted-out lead resumed';
  end if;
  -- Generic lease is allowed for notification work; engine independently gates AI/SMS on automation_active.
  lease:=public.calvren_acquire_lease(client_a,lead_a,fixed_now+interval '31 seconds',60);
  if lease is null then raise exception 'Notification worker cannot acquire handed-off lead'; end if;
  perform public.calvren_release_lease(client_a,lead_a,(lease->>'token')::uuid);
  begin
    perform public.calvren_save_client(config||jsonb_build_object('mode','demo'));
    raise exception 'Client mode changed with existing live leads';
  exception when invalid_parameter_value then null;
  end;

  -- Durable key hashes/limits, rotation and revocation.
  perform public.calvren_rotate_client_key(client_a,digest);
  if not public.calvren_verify_client_key(client_a,digest) or public.calvren_verify_client_key(client_b,digest) then
    raise exception 'Intake key tenant isolation failed';
  end if;
  perform public.calvren_rotate_client_key(client_a,repeat('b',64));
  if public.calvren_verify_client_key(client_a,digest) then raise exception 'Old intake key survived rotation'; end if;
  perform public.calvren_rotate_client_key(client_a,null);
  if public.calvren_verify_client_key(client_a,repeat('b',64)) then raise exception 'Revoked intake key survived'; end if;
  if not public.calvren_consume_rate_limit(digest,2,60,fixed_now) or
    not public.calvren_consume_rate_limit(digest,2,60,fixed_now) or
    public.calvren_consume_rate_limit(digest,2,60,fixed_now) then
    raise exception 'Durable rate limit failed';
  end if;
  if not public.calvren_consume_rate_limit(digest,2,60,fixed_now+interval '1 minute') then
    raise exception 'Rate-limit window did not reset';
  end if;
  raise notice 'Calvren SQL integration invariants passed';
end;
$$;
rollback;
