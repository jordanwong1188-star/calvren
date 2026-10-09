
begin;
do $$
declare result jsonb; old_revision uuid; id text := 'leads/12345678-1234-4123-8123-123456789abc';
begin
  if has_table_privilege('anon','public.calvren_private_records','SELECT') or
     has_table_privilege('authenticated','public.calvren_private_records','SELECT') or
     has_function_privilege('anon','public.calvren_private_write(text,jsonb,boolean,uuid)','EXECUTE') then
    raise exception 'Private hosting storage exposes browser privileges';
  end if;
  result := public.calvren_private_write(id,'{"original":true}',true,null);
  if not (result->>'modified')::boolean then raise exception 'Create failed'; end if;
  old_revision := (result->>'etag')::uuid;
  result := public.calvren_private_write(id,'{"overwrite":true}',true,null);
  if (result->>'modified')::boolean then raise exception 'Duplicate create overwrote record'; end if;
  result := public.calvren_private_write(id,'{"updated":true}',false,old_revision);
  if not (result->>'modified')::boolean then raise exception 'CAS failed'; end if;
  result := public.calvren_private_write(id,'{"stale":true}',false,old_revision);
  if (result->>'modified')::boolean then raise exception 'Stale CAS overwrote record'; end if;
  delete from public.calvren_private_records where key=id;
  result := public.calvren_private_write(id,'{"resurrected":true}',false,old_revision);
  if (result->>'modified')::boolean then raise exception 'CAS resurrected deleted record'; end if;
end $$;
rollback;
