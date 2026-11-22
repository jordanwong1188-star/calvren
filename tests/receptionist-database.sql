-- Integration tests for private Retell receptionist migration and safety gates.
begin;
do $$
begin
  if has_table_privilege('anon','public.calvren_receptionist_configs','SELECT')
    or has_table_privilege('authenticated','public.calvren_receptionist_calls','SELECT')
    or has_table_privilege('anon','public.calvren_receptionist_leads','INSERT')
    or has_function_privilege('anon','public.calvren_receptionist_capture_lead(text,text,text,text,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.calvren_receptionist_record_event(text,text,text,text,timestamptz,timestamptz)','EXECUTE')
    then raise exception 'Voice tables or RPCs must not be exposed to browser roles';
  end if;
end $$;
insert into public.calvren_clients(id,config) values
  ('retell-ci-live','{"id":"retell-ci-live","mode":"live","active":true,"business_name":"Retell CI Services"}'::jsonb);
insert into public.calvren_receptionist_configs(client_id,retell_agent_id,retell_phone_number)
  values ('retell-ci-live','agent_ci_test1','+16045550101');
do $$
begin
  if (select enabled from public.calvren_receptionist_configs where client_id='retell-ci-live') then
    raise exception 'New phone configurations must default inactive';
  end if;
  begin
    perform public.calvren_receptionist_record_event('retell-ci-live','call_ci_test1','agent_ci_test1','call_started',now(),null);
    raise exception 'Inactive clients must not write call events';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.calvren_receptionist_configs set enabled=true where client_id='retell-ci-live';
select public.calvren_receptionist_record_event('retell-ci-live','call_ci_test1','agent_ci_test1','call_started',now(),null);
select public.calvren_receptionist_record_event('retell-ci-live','call_ci_test1','agent_ci_test1','call_analyzed',null,now());
select public.calvren_receptionist_record_event('retell-ci-live','call_ci_test1','agent_ci_test1','call_ended',null,now());
select public.calvren_receptionist_record_event('retell-ci-live','call_ci_test1','agent_ci_test1','call_ended',null,now());
do $$
begin
  if (select last_event from public.calvren_receptionist_calls where call_id='call_ci_test1') <> 'call_analyzed'
    or (select event_rank from public.calvren_receptionist_calls where call_id='call_ci_test1')<>3
    or (select count(*) from public.calvren_receptionist_calls where call_id='call_ci_test1')<>1
  then raise exception 'Retell event state must be monotonic and idempotent'; end if;
end $$;
select public.calvren_receptionist_capture_lead(
  'retell-ci-live','call_ci_test1','agent_ci_test1','Alex','+16045550102','Leaky faucet','Tuesday');
select public.calvren_receptionist_capture_lead(
  'retell-ci-live','call_ci_test1','agent_ci_test1','Alex','+16045550102','Leaky faucet','Tuesday');
do $$
begin
  if (select count(*) from public.calvren_receptionist_leads where call_id='call_ci_test1')<>1
    or (select callback_consent from public.calvren_receptionist_leads where call_id='call_ci_test1') is distinct from true
  then raise exception 'Retell callback must be stored once with consent'; end if;
  begin
    perform public.calvren_receptionist_capture_lead('retell-ci-live','call_ci_test1','agent_other','Alex','+16045550102','Wrong agent','Monday');
    raise exception 'Mismatched Retell agent should be rejected';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.calvren_receptionist_configs set enabled=false where client_id='retell-ci-live';
do $$
begin
  begin
    perform public.calvren_receptionist_capture_lead('retell-ci-live','call_ci_test2','agent_ci_test1','Alex','+16045550102','Leaky faucet','');
    raise exception 'Disabled receptionist cannot capture a lead';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
