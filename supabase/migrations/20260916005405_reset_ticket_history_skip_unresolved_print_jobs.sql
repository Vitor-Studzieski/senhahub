-- Keep historical rows with unresolved receipts out of manager resets.
create or replace function public.reset_ticket_history(p_actor_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ticket_id uuid;
  v_candidate_ticket_ids uuid[] := array[]::uuid[];
  v_ticket_ids uuid[] := array[]::uuid[];
  v_deleted_tickets integer := 0;
  v_deleted_ratings integer := 0;
  v_skipped_tickets integer := 0;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_id
      and p.status = 'active'::public.user_status
      and p.role in ('manager'::public.user_role, 'admin'::public.user_role)
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  -- Lock terminal rows so tickets that finish after this reset starts stay in history.
  for v_ticket_id in
    select t.id
    from public.tickets t
    where t.status = any(array['atendido', 'cancelado', 'expirado']::public.ticket_status[])
    for update
  loop
    v_candidate_ticket_ids := array_append(v_candidate_ticket_ids, v_ticket_id);
  end loop;

  -- A pending or uncertain receipt is protected by the print subsystem. Skip its
  -- ticket instead of aborting the entire reset transaction.
  for v_ticket_id in
    select t.id
    from public.tickets t
    where t.id = any(v_candidate_ticket_ids)
      and not exists (
        select 1
        from public.print_jobs j
        where (j.ticket_id = t.id or j.payload->'ticketIds' @> to_jsonb(array[t.id::text]))
          and j.status <> 'printed'
          and j.resolved_at is null
      )
  loop
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
  end loop;
  v_skipped_tickets := cardinality(v_candidate_ticket_ids) - cardinality(v_ticket_ids);

  delete from public.ratings r
  where r.ticket_id = any(v_ticket_ids);
  get diagnostics v_deleted_ratings = row_count;

  delete from public.tickets t
  where t.id = any(v_ticket_ids);
  get diagnostics v_deleted_tickets = row_count;

  insert into public.events (
    id, type, entity_type, entity_id, customer_id, sector_id, payload, created_at
  ) values (
    gen_random_uuid(),
    'ticket_history_reset',
    'admin_action',
    p_actor_id::text,
    p_actor_id,
    null,
    jsonb_build_object(
      'deleted_tickets', v_deleted_tickets,
      'deleted_ratings', v_deleted_ratings,
      'skipped_tickets', v_skipped_tickets
    ),
    now()
  );

  return jsonb_build_object(
    'deletedTickets', v_deleted_tickets,
    'deletedRatings', v_deleted_ratings,
    'skippedTickets', v_skipped_tickets
  );
end;
$$;

revoke all on function public.reset_ticket_history(uuid) from public, anon, authenticated;
grant execute on function public.reset_ticket_history(uuid) to service_role;
notify pgrst, 'reload schema';
