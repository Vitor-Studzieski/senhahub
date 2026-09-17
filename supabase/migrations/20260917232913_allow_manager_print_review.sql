-- The operations panel is available to managers and administrators. Keep the
-- database guard aligned with the API and the panel so managers can release a
-- printer blocked by an uncertain physical result.
create or replace function public.resolve_print_job_v2(
  p_actor_id uuid,
  p_job_id uuid,
  p_request_id uuid,
  p_action text,
  p_reason text,
  p_writer_stopped boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  j public.print_jobs;
  op public.print_operations;
  child public.print_jobs;
  result jsonb;
begin
  if not exists(
    select 1
    from public.profiles
    where id = p_actor_id
      and role in ('admin'::public.user_role, 'manager'::public.user_role)
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_writer_stopped is distinct from true
     or length(trim(coalesce(p_reason, ''))) < 5
     or p_request_id is null then
    raise exception 'operator_confirmation_required';
  end if;

  select * into j from public.print_jobs where id = p_job_id;
  if not found then raise exception 'job_not_found'; end if;

  perform 1 from public.print_printers where id = j.printer_id for update;
  select * into j from public.print_jobs where id = p_job_id for update;

  select * into op from public.print_operations where request_id = p_request_id;
  if found then
    if op.actor_id <> p_actor_id or op.job_id <> p_job_id or op.action <> p_action then
      raise exception 'operation_conflict';
    end if;
    return op.result;
  end if;

  if j.protocol_version <> 2
     or j.status not in ('needs_review', 'failed', 'printed')
     or p_action not in ('confirm_printed', 'resolve_failed', 'reprint') then
    raise exception 'invalid_resolution';
  end if;
  if j.resolved_at is not null then raise exception 'already_resolved'; end if;

  update public.print_jobs
  set status = case
      when p_action = 'confirm_printed' then 'printed'
      when j.status = 'needs_review' then 'failed'
      else j.status
    end,
    resolved_at = now(),
    printed_at = case when p_action = 'confirm_printed' then now() else j.printed_at end
  where id = j.id
  returning * into j;

  update public.print_printers
  set blocked_job_id = null
  where id = j.printer_id and blocked_job_id = j.id;

  if p_action = 'reprint' then
    insert into public.print_jobs(
      ticket_id,
      kiosk_id,
      idempotency_key,
      payload,
      reprint_of
    )
    values(
      j.ticket_id,
      j.kiosk_id,
      'reprint:' || p_request_id::text,
      j.payload,
      j.id
    )
    returning * into child;
  end if;

  result := jsonb_build_object(
    'job', to_jsonb(j),
    'reprint', case when child.id is null then null else to_jsonb(child) end
  );

  insert into public.print_operations(
    actor_id,
    job_id,
    request_id,
    action,
    reason,
    result
  ) values (
    p_actor_id,
    j.id,
    p_request_id,
    p_action,
    p_reason,
    result
  );

  return result;
end;
$$;
