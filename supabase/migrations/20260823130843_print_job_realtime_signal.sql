-- Low-sensitivity wake-up signal for the print agent.
-- The payload contains only the kiosk id. Claiming a job remains protected by
-- the print-agent token and the claim_next_print_job RPC.

create or replace function public.broadcast_print_job_created()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  perform realtime.send(
    jsonb_build_object('kiosk_id', NEW.kiosk_id),
    'print_job.created',
    'senhahub:print:' || NEW.kiosk_id,
    false
  );
  return NEW;
end;
$$;

revoke all on function public.broadcast_print_job_created() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'drop trigger if exists print_jobs_broadcast_created on public.print_jobs';
    execute '
      create trigger print_jobs_broadcast_created
      after insert on public.print_jobs
      for each row
      execute function public.broadcast_print_job_created()
    ';
  end if;
end
$$;
