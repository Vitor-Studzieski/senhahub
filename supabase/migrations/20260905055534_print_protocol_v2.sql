-- Additive protocol: v1 remains available only on explicitly v1 destinations.
-- No destination is activated automatically. Apply with a migration transaction.
create table public.print_printers (
  id uuid primary key default gen_random_uuid(),
  store_code text not null,
  hardware_key text not null unique,
  name text not null,
  blocked_job_id uuid,
  created_at timestamptz not null default now(),
  unique(id, store_code)
);
alter table public.print_kiosks
  add column protocol_version smallint not null default 1 check (protocol_version in (1,2)),
  add column printer_id uuid unique references public.print_printers(id),
  add constraint print_kiosks_printer_store_fk foreign key(printer_id, store_code) references public.print_printers(id,store_code);
alter table public.print_kiosks add constraint print_kiosks_device_scope_unique unique(id,store_code,printer_id);
create table public.print_devices (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  token_hash text unique,
  kiosk_id text not null,
  store_code text not null,
  printer_id uuid not null,
  name text not null,
  agent_version text not null default '',
  capabilities jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(kiosk_id,store_code,printer_id) references public.print_kiosks(id,store_code,printer_id),
  check(auth_user_id is not null or token_hash is not null)
);
alter table public.print_jobs
  add column protocol_version smallint not null default 1 check(protocol_version in (1,2)),
  add column device_id uuid references public.print_devices(id),
  add column printer_id uuid references public.print_printers(id),
  add column lease_id uuid,
  add column lease_expires_at timestamptz,
  add column attempt_version integer not null default 0,
  add column next_attempt_at timestamptz,
  add column send_started_at timestamptz,
  add column reprint_of uuid references public.print_jobs(id),
  add column resolved_at timestamptz;
alter table public.print_jobs drop constraint print_jobs_status_check;
alter table public.print_jobs add constraint print_jobs_status_check check(status in ('pending','leased','printing','retry_wait','needs_review','printed','failed'));
alter table public.print_jobs drop constraint print_jobs_ticket_id_key;
alter table public.print_jobs alter column ticket_id drop not null;
alter table public.print_jobs drop constraint print_jobs_ticket_id_fkey;
alter table public.print_jobs add constraint print_jobs_ticket_id_fkey foreign key(ticket_id) references public.tickets(id) on delete set null;
create unique index print_jobs_original_ticket on public.print_jobs(ticket_id) where reprint_of is null;
alter table public.print_printers add constraint print_printers_blocked_job_fk foreign key(blocked_job_id) references public.print_jobs(id);
create unique index print_jobs_one_writer on public.print_jobs(printer_id) where protocol_version=2 and status in ('leased','printing','needs_review');
create index print_jobs_eligible_v2 on public.print_jobs(kiosk_id,next_attempt_at,created_at) where protocol_version=2 and status in ('pending','retry_wait');
create index print_jobs_leases_v2 on public.print_jobs(lease_expires_at) where protocol_version=2 and status in ('leased','printing');
create index print_jobs_device_v2 on public.print_jobs(device_id) where protocol_version=2 and status in ('leased','printing','needs_review');
alter table public.print_job_attempts
  add column device_id uuid references public.print_devices(id),
  add column lease_id uuid,
  add column request_id uuid,
  add column finish_outcome text,
  add column finish_result jsonb;
alter table public.print_job_attempts drop constraint print_job_attempts_status_check;
alter table public.print_job_attempts add constraint print_job_attempts_status_check check(status in ('leased','printing','printed','failed','reprocessed','retry_wait','needs_review'));
create unique index print_attempt_lease on public.print_job_attempts(lease_id) where lease_id is not null;
create unique index print_attempt_request on public.print_job_attempts(device_id,request_id) where request_id is not null;
create table public.print_operations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  job_id uuid not null references public.print_jobs(id) on delete restrict,
  action text not null,
  reason text not null check(length(reason) between 5 and 500),
  request_id uuid not null unique,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.print_emissions (
  kiosk_id text not null references public.print_kiosks(id),
  idempotency_key text not null,
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(kiosk_id,idempotency_key)
);
create table public.print_signal_failures (
  id uuid primary key default gen_random_uuid(),
  kiosk_id text not null,
  error_code text not null,
  created_at timestamptz not null default now()
);
create table public.maintenance_leases (
  name text primary key,
  owner_id uuid not null,
  expires_at timestamptz not null
);

-- Protect all tickets in a bundled receipt; retain immutable receipt/history after cleanup.
create function public.protect_unresolved_print_ticket() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.print_jobs j where (j.ticket_id=old.id or j.payload->'ticketIds' @> to_jsonb(array[old.id::text]))
    and j.status <> 'printed' and j.resolved_at is null) then
    raise exception 'unresolved_print_job' using errcode='23503';
  end if;
  return old;
end $$;
create trigger tickets_protect_unresolved_print before delete on public.tickets for each row execute function public.protect_unresolved_print_ticket();
create function public.stamp_print_job_protocol() returns trigger
language plpgsql set search_path='' as $$
begin
  select k.protocol_version,k.printer_id into new.protocol_version,new.printer_id from public.print_kiosks k where k.id=new.kiosk_id;
  return new;
end $$;
create trigger print_jobs_protocol before insert on public.print_jobs for each row execute function public.stamp_print_job_protocol();

-- Lock order for every command: device -> physical printer -> job -> attempt.
create function public.lock_print_device_v2(p_device_id uuid) returns public.print_devices
language plpgsql set search_path='' as $$
declare d public.print_devices;
begin
  select * into d from public.print_devices where id=p_device_id for update;
  if not found or not d.active or d.revoked_at is not null then raise exception 'device_revoked' using errcode='42501'; end if;
  if not exists(select 1 from public.print_kiosks k where k.id=d.kiosk_id and k.active and k.protocol_version=2 and k.store_code=d.store_code and k.printer_id=d.printer_id) then
    raise exception 'device_scope_invalid' using errcode='42501';
  end if;
  perform 1 from public.print_printers where id=d.printer_id and store_code=d.store_code for update;
  if not found then raise exception 'printer_scope_invalid' using errcode='42501'; end if;
  return d;
end $$;

create function public.recover_print_printer_v2(p_printer_id uuid) returns void
language plpgsql set search_path='' as $$
declare j public.print_jobs;
begin
  perform 1 from public.print_printers where id=p_printer_id for update;
  for j in select * from public.print_jobs where printer_id=p_printer_id and protocol_version=2 and status in ('leased','printing') and lease_expires_at <= now() for update loop
    if j.status='printing' then
      update public.print_jobs set status='needs_review',last_error='Lease expired after start; physical result unknown' where id=j.id;
      update public.print_printers set blocked_job_id=j.id where id=p_printer_id;
      update public.print_job_attempts set status='needs_review',error_message='Lease expired after start' where lease_id=j.lease_id;
    else
      update public.print_jobs set status=case when attempts>=5 then 'failed' else 'retry_wait' end,
        next_attempt_at=now(),last_error='Lease expired before start' where id=j.id;
      update public.print_job_attempts set status='reprocessed',finished_at=now(),error_message='Lease expired before start' where lease_id=j.lease_id;
    end if;
  end loop;
end $$;
create function public.sweep_print_leases_v2() returns void
language plpgsql set search_path='' as $$
declare p record;
begin
  for p in select distinct printer_id from public.print_jobs where protocol_version=2 and status in ('leased','printing') and lease_expires_at<=now() order by printer_id loop
    perform public.recover_print_printer_v2(p.printer_id);
  end loop;
end $$;

create function public.recover_print_execution_v2(p_device_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare d public.print_devices; j public.print_jobs;
begin
  d := public.lock_print_device_v2(p_device_id);
  perform public.recover_print_printer_v2(d.printer_id);
  select * into j from public.print_jobs where device_id=d.id and printer_id=d.printer_id and status in ('leased','printing','needs_review') order by created_at limit 1;
  return jsonb_build_object('job',case when j.id is null then null else to_jsonb(j) end,
    'blocked',exists(select 1 from public.print_printers where id=d.printer_id and blocked_job_id is not null),
    'nextAttemptAt',(select min(next_attempt_at) from public.print_jobs where kiosk_id=d.kiosk_id and status='retry_wait'));
end $$;

create function public.claim_next_print_job_v2(p_device_id uuid,p_request_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare d public.print_devices; j public.print_jobs; a public.print_job_attempts; recovery jsonb;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  d := public.lock_print_device_v2(p_device_id);
  recovery := public.recover_print_execution_v2(p_device_id);
  select * into a from public.print_job_attempts where device_id=d.id and request_id=p_request_id;
  if found then
    select * into j from public.print_jobs where id=a.job_id;
    if j.lease_id is distinct from a.lease_id then raise exception 'stale_claim' using errcode='40001'; end if;
    return jsonb_build_object('job',to_jsonb(j));
  end if;
  if recovery->'job' <> 'null'::jsonb or (recovery->>'blocked')::boolean then return recovery || jsonb_build_object('job',null,'blocked',true); end if;
  if exists(select 1 from public.print_jobs where printer_id=d.printer_id and status in ('leased','printing','needs_review')) then return jsonb_build_object('job',null); end if;
  select * into j from public.print_jobs where kiosk_id=d.kiosk_id and printer_id=d.printer_id and protocol_version=2 and attempts<5
    and (status='pending' or (status='retry_wait' and next_attempt_at<=now())) order by created_at,id limit 1 for update skip locked;
  if not found then return recovery; end if;
  update public.print_jobs set status='leased',device_id=d.id,lease_id=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds',
    attempt_version=attempt_version+1,attempts=attempts+1,claimed_at=now(),send_started_at=null,next_attempt_at=null,last_error=null,failed_at=null
    where id=j.id returning * into j;
  insert into public.print_job_attempts(job_id,kiosk_id,attempt_number,status,device_id,lease_id,request_id,started_at)
    values(j.id,j.kiosk_id,j.attempt_version,'leased',d.id,j.lease_id,p_request_id,now());
  update public.print_devices set last_seen_at=now() where id=d.id;
  return jsonb_build_object('job',to_jsonb(j));
end $$;

create function public.lock_print_attempt_v2(p_device_id uuid,p_job_id uuid,p_lease_id uuid,p_attempt_version integer) returns public.print_jobs
language plpgsql set search_path='' as $$
declare d public.print_devices; j public.print_jobs;
begin
  d := public.lock_print_device_v2(p_device_id);
  select * into j from public.print_jobs where id=p_job_id for update;
  if not found or j.protocol_version<>2 or j.device_id is distinct from d.id or j.kiosk_id<>d.kiosk_id or j.printer_id<>d.printer_id
    or j.lease_id is distinct from p_lease_id or j.attempt_version is distinct from p_attempt_version then
    raise exception 'print_owner_mismatch' using errcode='42501';
  end if;
  return j;
end $$;
create function public.start_print_job_v2(p_device_id uuid,p_job_id uuid,p_lease_id uuid,p_attempt_version integer) returns jsonb
language plpgsql set search_path='' as $$
declare j public.print_jobs;
begin
  j := public.lock_print_attempt_v2(p_device_id,p_job_id,p_lease_id,p_attempt_version);
  if j.lease_expires_at<=now() then raise exception 'lease_expired' using errcode='40001'; end if;
  if j.status='printing' then return jsonb_build_object('job',to_jsonb(j)); end if;
  if j.status<>'leased' then raise exception 'invalid_print_transition'; end if;
  update public.print_jobs set status='printing',send_started_at=now(),lease_expires_at=now()+interval '90 seconds' where id=j.id returning * into j;
  update public.print_job_attempts set status='printing' where lease_id=j.lease_id;
  return jsonb_build_object('job',to_jsonb(j));
end $$;
create function public.renew_print_lease_v2(p_device_id uuid,p_job_id uuid,p_lease_id uuid,p_attempt_version integer) returns jsonb
language plpgsql set search_path='' as $$
declare j public.print_jobs;
begin
  j := public.lock_print_attempt_v2(p_device_id,p_job_id,p_lease_id,p_attempt_version);
  if j.status not in ('leased','printing') or j.lease_expires_at<=now() or j.claimed_at<now()-interval '10 minutes' then raise exception 'lease_expired'; end if;
  update public.print_jobs set lease_expires_at=now()+interval '90 seconds' where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j));
end $$;
create function public.finish_print_job_v2(p_device_id uuid,p_job_id uuid,p_lease_id uuid,p_attempt_version integer,p_outcome text,p_error text default null) returns jsonb
language plpgsql set search_path='' as $$
declare j public.print_jobs; a public.print_job_attempts; result jsonb;
begin
  j := public.lock_print_attempt_v2(p_device_id,p_job_id,p_lease_id,p_attempt_version);
  select * into a from public.print_job_attempts where lease_id=j.lease_id for update;
  if a.finish_outcome is not null then
    if a.finish_outcome<>p_outcome then raise exception 'finish_conflict'; end if;
    return a.finish_result;
  end if;
  if p_outcome is null or p_outcome not in ('printed','before_send','unknown') then raise exception 'invalid_print_outcome'; end if;
  if p_outcome='before_send' and j.status in ('retry_wait','failed') and j.send_started_at is null and j.resolved_at is null then
    result := jsonb_build_object('ok',true,'job',to_jsonb(j),'nextAttemptAt',j.next_attempt_at);
    update public.print_job_attempts set finish_outcome=p_outcome,finish_result=result where id=a.id;
    return result;
  end if;
  if j.resolved_at is not null or j.status not in ('leased','printing','needs_review') then raise exception 'invalid_print_transition'; end if;
  if p_outcome='printed' and j.send_started_at is null then raise exception 'print_not_started'; end if;
  if p_outcome='before_send' and j.status='needs_review' then raise exception 'review_required'; end if;
  update public.print_jobs set status=case p_outcome when 'printed' then 'printed' when 'unknown' then 'needs_review' else case when attempts>=5 then 'failed' else 'retry_wait' end end,
    printed_at=case when p_outcome='printed' then now() else null end,
    failed_at=case when p_outcome<>'printed' then now() else null end,
    next_attempt_at=case when p_outcome='before_send' and attempts<5 then now()+make_interval(secs=>least(300,15*(2^least(attempts,4))::integer)) else null end,
    last_error=case when p_outcome='printed' then null else left(coalesce(p_error,p_outcome),500) end
    where id=j.id returning * into j;
  update public.print_printers set blocked_job_id=case when j.status='needs_review' then j.id else null end where id=j.printer_id;
  result := jsonb_build_object('ok',true,'job',to_jsonb(j),'nextAttemptAt',j.next_attempt_at);
  update public.print_job_attempts set status=j.status,finish_outcome=p_outcome,finish_result=result,finished_at=now(),
    duration_ms=greatest(0,(extract(epoch from (now()-started_at))*1000)::bigint),error_message=j.last_error where id=a.id;
  update public.print_devices set last_seen_at=now() where id=p_device_id;
  return result;
end $$;

-- Requires an authenticated administrator in the API; DB verifies actor scope again.
create function public.resolve_print_job_v2(p_actor_id uuid,p_job_id uuid,p_request_id uuid,p_action text,p_reason text,p_writer_stopped boolean) returns jsonb
language plpgsql set search_path='' as $$
declare j public.print_jobs; op public.print_operations; child public.print_jobs; result jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'admin_required' using errcode='42501'; end if;
  if p_writer_stopped is distinct from true or length(trim(coalesce(p_reason,'')))<5 or p_request_id is null then raise exception 'operator_confirmation_required'; end if;
  select * into j from public.print_jobs where id=p_job_id;
  if not found then raise exception 'job_not_found'; end if;
  perform 1 from public.print_printers where id=j.printer_id for update;
  select * into j from public.print_jobs where id=p_job_id for update;
  select * into op from public.print_operations where request_id=p_request_id;
  if found then
    if op.actor_id<>p_actor_id or op.job_id<>p_job_id or op.action<>p_action then raise exception 'operation_conflict'; end if;
    return op.result;
  end if;
  if j.protocol_version<>2 or j.status not in ('needs_review','failed','printed') or p_action not in ('confirm_printed','resolve_failed','reprint') then raise exception 'invalid_resolution'; end if;
  if j.resolved_at is not null then raise exception 'already_resolved'; end if;
  update public.print_jobs set status=case when p_action='confirm_printed' then 'printed' when status='needs_review' then 'failed' else status end,
    resolved_at=now(),printed_at=case when p_action='confirm_printed' then now() else printed_at end where id=j.id returning * into j;
  update public.print_printers set blocked_job_id=null where id=j.printer_id and blocked_job_id=j.id;
  if p_action='reprint' then
    insert into public.print_jobs(ticket_id,kiosk_id,idempotency_key,payload,reprint_of)
      values(j.ticket_id,j.kiosk_id,'reprint:'||p_request_id::text,j.payload,j.id) returning * into child;
  end if;
  result := jsonb_build_object('job',to_jsonb(j),'reprint',case when child.id is null then null else to_jsonb(child) end);
  insert into public.print_operations(actor_id,job_id,request_id,action,reason,result) values(p_actor_id,j.id,p_request_id,p_action,p_reason,result);
  return result;
end $$;

-- Explicit cutover; pending jobs are safe to adopt, historical failures need review.
create function public.activate_print_protocol_v2(p_kiosk_id text) returns void
language plpgsql set search_path='' as $$
declare k public.print_kiosks;
begin
  select * into k from public.print_kiosks where id=p_kiosk_id for update;
  if not found or k.printer_id is null then raise exception 'printer_registration_required'; end if;
  perform 1 from public.print_printers where id=k.printer_id for update;
  if exists(select 1 from public.print_jobs where kiosk_id=k.id and status in ('printing','leased','needs_review')) then raise exception 'active_execution_requires_resolution'; end if;
  update public.print_kiosks set protocol_version=2 where id=k.id;
  update public.print_jobs set protocol_version=2,printer_id=k.printer_id where kiosk_id=k.id and status='pending';
end $$;

create or replace function public.claim_next_print_job(p_kiosk_id text) returns public.print_jobs
language plpgsql set search_path='' as $$
declare j public.print_jobs;
begin
  perform 1 from public.print_kiosks where id=p_kiosk_id and active and protocol_version=1 for update;
  if not found then raise exception 'print_protocol_upgrade_required'; end if;
  select * into j from public.print_jobs where kiosk_id=p_kiosk_id and protocol_version=1 and attempts<5
    and (status in ('pending','failed') or (status='printing' and claimed_at<now()-interval '2 minutes')) order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.print_jobs set status='printing',attempts=attempts+1,claimed_at=now(),failed_at=null,last_error=null where id=j.id returning * into j;
  update public.print_kiosks set last_seen_at=now() where id=p_kiosk_id;
  return j;
end $$;
create or replace function public.finish_print_job(p_job_id uuid,p_kiosk_id text,p_success boolean,p_error text default null) returns public.print_jobs
language plpgsql set search_path='' as $$
declare j public.print_jobs;
begin
  perform 1 from public.print_kiosks where id=p_kiosk_id and protocol_version=1 for update;
  if not found then raise exception 'print_protocol_upgrade_required'; end if;
  update public.print_jobs set status=case when p_success then 'printed' else 'failed' end,
    printed_at=case when p_success then now() else null end,failed_at=case when p_success then null else now() end,last_error=left(p_error,500)
    where id=p_job_id and kiosk_id=p_kiosk_id and protocol_version=1 and status='printing' returning * into j;
  if not found then raise exception 'print_job_not_claimed'; end if;
  return j;
end $$;

create function public.acquire_maintenance_lease(p_owner_id uuid) returns boolean
language plpgsql set search_path='' as $$
begin
  insert into public.maintenance_leases(name,owner_id,expires_at) values('general',p_owner_id,now()+interval '5 minutes')
    on conflict(name) do update set owner_id=excluded.owner_id,expires_at=excluded.expires_at where public.maintenance_leases.expires_at<now();
  return found;
end $$;
create function public.release_maintenance_lease(p_owner_id uuid) returns void
language sql set search_path='' as $$ delete from public.maintenance_leases where name='general' and owner_id=p_owner_id $$;

-- Realtime membership exposes only a boolean, never device credentials.
create schema if not exists print_private;
create function print_private.can_receive_print(p_topic text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.print_devices d join public.print_kiosks k on k.id=d.kiosk_id
    where d.auth_user_id=auth.uid() and d.active and d.revoked_at is null and k.active and k.protocol_version=2
    and d.printer_id=k.printer_id and d.store_code=k.store_code and p_topic='senhahub:print:v2:'||d.kiosk_id)
$$;
revoke all on function print_private.can_receive_print(text) from public;
grant usage on schema print_private to authenticated;
grant execute on function print_private.can_receive_print(text) to authenticated;
do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$create policy print_v2_receive on realtime.messages for select to authenticated using(extension='broadcast' and print_private.can_receive_print((select realtime.topic())))$policy$;
    -- Restrictive guard also protects this namespace from unrelated permissive policies.
    execute $policy$create policy print_v2_receive_guard on realtime.messages as restrictive for select to authenticated using((select realtime.topic()) not like 'senhahub:print:v2:%' or (extension='broadcast' and print_private.can_receive_print((select realtime.topic()))))$policy$;
    execute $policy$create policy print_v2_no_publish on realtime.messages as restrictive for insert to authenticated with check((select realtime.topic()) not like 'senhahub:print:v2:%')$policy$;
  end if;
end $$;
create or replace function public.broadcast_print_job_created() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.protocol_version=2 then
    if tg_op='UPDATE' and not ((new.status in ('pending','retry_wait') and (old.status is distinct from new.status or old.next_attempt_at is distinct from new.next_attempt_at))
      or (new.resolved_at is not null and old.resolved_at is null)) then return new; end if;
    if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
      begin
        perform realtime.send(jsonb_build_object('kiosk_id',new.kiosk_id),'print_job.available','senhahub:print:v2:'||new.kiosk_id,true);
      exception when others then
        insert into public.print_signal_failures(kiosk_id,error_code) values(new.kiosk_id,sqlstate);
        raise warning 'print_signal_failed kiosk=% sqlstate=%',new.kiosk_id,sqlstate;
      end;
    end if;
    -- Local PostgreSQL uses LISTEN/NOTIFY through an authenticated SSE adapter.
    perform pg_notify('senhahub_print_v2',jsonb_build_object('kiosk_id',new.kiosk_id)::text);
  elsif tg_op='INSERT' and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send(jsonb_build_object('kiosk_id',new.kiosk_id),'print_job.created','senhahub:print:'||new.kiosk_id,false);
  end if;
  return new;
end $$;
drop trigger if exists print_jobs_broadcast_created on public.print_jobs;
create trigger print_jobs_broadcast_created after insert or update of status,next_attempt_at on public.print_jobs for each row execute function public.broadcast_print_job_created();

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.raw_app_meta_data->>'identity_type'='print_device' then return new; end if;
  insert into public.profiles(id,email,name,role) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'name',split_part(coalesce(new.email,''),'@',1),'Usuario'),'customer') on conflict(id) do nothing;
  return new;
end $$;

alter function public.issue_physical_ticket(text, text, text, text, text, boolean, text, integer) rename to issue_physical_ticket_legacy;
create function public.issue_physical_ticket(p_kiosk_id text,p_sector_id text,p_idempotency_key text,p_install_url text,p_app_url text default 'https://senhahub.vercel.app',p_priority boolean default false,p_priority_reason text default null,p_auto_call_delay_seconds integer default 30)
returns jsonb language plpgsql set search_path='' as $$
declare req jsonb; saved public.print_emissions; result_value jsonb; legacy public.print_jobs;
begin
  if length(coalesce(p_idempotency_key,'')) not between 16 and 160 then raise exception 'invalid_idempotency_key'; end if;
  req := jsonb_build_object('sectors',jsonb_build_array(p_sector_id),'priority',coalesce(p_priority,false),'priorityReason',p_priority_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_kiosk_id||':'||p_idempotency_key,0));
  select * into saved from public.print_emissions where kiosk_id=p_kiosk_id and idempotency_key=p_idempotency_key;
  if found then
    if saved.request<>req then raise exception 'idempotency_conflict'; end if;
    return saved.result || jsonb_build_object('alreadyExists',true);
  end if;
  -- Legacy unscoped keys may still be retried during rollout, but cannot cross scope.
  select * into legacy from public.print_jobs where idempotency_key=p_idempotency_key;
  if found then
    if legacy.kiosk_id<>p_kiosk_id or coalesce(legacy.payload->'priority','false'::jsonb)<>req->'priority'
      or coalesce(legacy.payload->'priorityReason','null'::jsonb)<>req->'priorityReason'
      or coalesce((select jsonb_agg(s order by s) from (select distinct t->>'sectorId' s from jsonb_array_elements(legacy.payload->'tickets') t) n),jsonb_build_array(legacy.payload->>'sectorId'))<>req->'sectors' then
      raise exception 'idempotency_conflict';
    end if;
  end if;
  insert into public.print_emissions(kiosk_id,idempotency_key,request) values(p_kiosk_id,p_idempotency_key,req);
  result_value := public.issue_physical_ticket_legacy(p_kiosk_id,p_sector_id,case when legacy.id is not null then p_idempotency_key else 'v2:'||md5(p_kiosk_id||':'||p_idempotency_key) end,p_install_url,p_app_url,p_priority,p_priority_reason,p_auto_call_delay_seconds);
  update public.print_emissions e set result=result_value where e.kiosk_id=p_kiosk_id and e.idempotency_key=p_idempotency_key;
  return result_value;
end $$;

alter function public.issue_physical_ticket_bundle(text, text[], text, text, text, boolean, text, integer) rename to issue_physical_ticket_bundle_legacy;
create function public.issue_physical_ticket_bundle(p_kiosk_id text,p_sector_ids text[],p_idempotency_key text,p_install_url text,p_app_url text default 'https://senhahub.vercel.app',p_priority boolean default false,p_priority_reason text default null,p_auto_call_delay_seconds integer default 30)
returns jsonb language plpgsql set search_path='' as $$
declare req jsonb; saved public.print_emissions; result_value jsonb; legacy public.print_jobs;
begin
  if length(coalesce(p_idempotency_key,'')) not between 16 and 160 then raise exception 'invalid_idempotency_key'; end if;
  req := jsonb_build_object('sectors',(select jsonb_agg(s order by s) from (select distinct trim(x) s from unnest(p_sector_ids) x) n),'priority',coalesce(p_priority,false),'priorityReason',p_priority_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_kiosk_id||':'||p_idempotency_key,0));
  select * into saved from public.print_emissions where kiosk_id=p_kiosk_id and idempotency_key=p_idempotency_key;
  if found then
    if saved.request<>req then raise exception 'idempotency_conflict'; end if;
    return saved.result || jsonb_build_object('alreadyExists',true);
  end if;
  -- Legacy unscoped keys may still be retried during rollout, but cannot cross scope.
  select * into legacy from public.print_jobs where idempotency_key=p_idempotency_key;
  if found then
    if legacy.kiosk_id<>p_kiosk_id or coalesce(legacy.payload->'priority','false'::jsonb)<>req->'priority'
      or coalesce(legacy.payload->'priorityReason','null'::jsonb)<>req->'priorityReason'
      or coalesce((select jsonb_agg(s order by s) from (select distinct t->>'sectorId' s from jsonb_array_elements(legacy.payload->'tickets') t) n),jsonb_build_array(legacy.payload->>'sectorId'))<>req->'sectors' then
      raise exception 'idempotency_conflict';
    end if;
  end if;
  insert into public.print_emissions(kiosk_id,idempotency_key,request) values(p_kiosk_id,p_idempotency_key,req);
  result_value := public.issue_physical_ticket_bundle_legacy(p_kiosk_id,p_sector_ids,case when legacy.id is not null then p_idempotency_key else 'v2:'||md5(p_kiosk_id||':'||p_idempotency_key) end,p_install_url,p_app_url,p_priority,p_priority_reason,p_auto_call_delay_seconds);
  update public.print_emissions e set result=result_value where e.kiosk_id=p_kiosk_id and e.idempotency_key=p_idempotency_key;
  return result_value;
end $$;

-- Privileges are explicit, including helpers. No RPC is exposed to devices.
do $$ declare r record; t text; begin
  foreach t in array array['print_printers','print_devices','print_operations','print_emissions','print_signal_failures','maintenance_leases'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    if exists(select 1 from pg_roles where rolname='senhahub_service') then
      execute format('grant select,insert,update,delete on public.%I to senhahub_service',t);
      execute format('create policy senhahub_service_backend_access on public.%I for all to senhahub_service using(true) with check(true)',t);
    end if;
  end loop;
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
    (p.proname in ('claim_next_print_job','finish_print_job','issue_physical_ticket','issue_physical_ticket_bundle','issue_physical_ticket_legacy','issue_physical_ticket_bundle_legacy','protect_unresolved_print_ticket','stamp_print_job_protocol','broadcast_print_job_created','acquire_maintenance_lease','release_maintenance_lease') or p.proname like '%print%v2') loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
    if exists(select 1 from pg_roles where rolname='senhahub_service') then execute format('grant execute on function %s to senhahub_service',r.signature); end if;
  end loop;
end $$;

create table public.print_enrollments (
  code_hash text primary key,
  device_id uuid not null references public.print_devices(id),
  secret text,
  expires_at timestamptz not null default now()+interval '10 minutes',
  used_at timestamptz
);
alter table public.print_enrollments enable row level security;
revoke all on public.print_enrollments from public,anon,authenticated;
grant select,insert,update,delete on public.print_enrollments to service_role;
create function public.provision_print_device_v2(p_actor_id uuid,p_device_id uuid,p_auth_user_id uuid,p_kiosk_id text,p_name text,p_code_hash text,p_secret text) returns jsonb
language plpgsql set search_path='' as $$
declare k public.print_kiosks;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'admin_required' using errcode='42501'; end if;
  select * into k from public.print_kiosks where id=p_kiosk_id for update;
  if not found or k.printer_id is null or not k.active then raise exception 'printer_registration_required'; end if;
  insert into public.print_devices(id,auth_user_id,kiosk_id,store_code,printer_id,name) values(p_device_id,p_auth_user_id,k.id,k.store_code,k.printer_id,p_name);
  insert into public.print_enrollments(code_hash,device_id,secret) values(p_code_hash,p_device_id,p_secret);
  return jsonb_build_object('deviceId',p_device_id);
end $$;
create function public.consume_print_enrollment_v2(p_code_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare e public.print_enrollments;
begin
  select * into e from public.print_enrollments where code_hash=p_code_hash and used_at is null and expires_at>now() for update;
  if not found then return null; end if;
  if not exists(select 1 from public.print_devices where id=e.device_id and active and revoked_at is null) then return null; end if;
  update public.print_enrollments set used_at=now(),secret=null where code_hash=p_code_hash;
  return jsonb_build_object('secret',e.secret);
end $$;
revoke all on function public.provision_print_device_v2(uuid,uuid,uuid,text,text,text,text),public.consume_print_enrollment_v2(text) from public,anon,authenticated;
grant execute on function public.provision_print_device_v2(uuid,uuid,uuid,text,text,text,text),public.consume_print_enrollment_v2(text) to service_role;

create function public.record_print_device_session_v2(p_device_id uuid,p_version text) returns void
language plpgsql set search_path='' as $$
declare d public.print_devices;
begin
  d:=public.lock_print_device_v2(p_device_id);
  update public.print_devices set agent_version=left(p_version,80),last_seen_at=now() where id=d.id;
end $$;
revoke all on function public.record_print_device_session_v2(uuid,text) from public,anon,authenticated;
grant execute on function public.record_print_device_session_v2(uuid,text) to service_role;
do $$ begin
 if exists(select 1 from pg_roles where rolname='senhahub_service') then
  grant execute on function public.record_print_device_session_v2(uuid,text) to senhahub_service;
 end if;
end $$;
