-- A restarted writer may replay an old local phase after the server already
-- durably confirmed the physical print. Treat the durable printed outcome as
-- authoritative so the agent can clear its journal and resume the queue
-- without sending a duplicate receipt.
create or replace function public.finish_print_job_v2(p_device_id uuid,p_job_id uuid,p_lease_id uuid,p_attempt_version integer,p_outcome text,p_error text default null) returns jsonb
language plpgsql set search_path='' as $$
declare j public.print_jobs; a public.print_job_attempts; result jsonb;
begin
  j := public.lock_print_attempt_v2(p_device_id,p_job_id,p_lease_id,p_attempt_version);
  select * into a from public.print_job_attempts where lease_id=j.lease_id for update;
  if a.finish_outcome is not null then
    if a.finish_outcome='printed' then return a.finish_result; end if;
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
