create table public.print_paper_roll_events (
  id uuid primary key default gen_random_uuid(),
  printer_key text not null,
  printer_name text not null,
  event_type text not null check (event_type in ('initialized', 'replaced')),
  baseline_count integer not null check (baseline_count between 0 and 10000),
  actor_id text not null,
  actor_name text not null,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  constraint print_paper_roll_events_baseline_check
    check (event_type <> 'replaced' or baseline_count = 0)
);

create index print_paper_roll_events_latest_by_printer
  on public.print_paper_roll_events (printer_key, created_at desc);

create index if not exists print_jobs_confirmed_for_paper_roll
  on public.print_jobs (updated_at, kiosk_id) where status = 'printed';

create index if not exists print_jobs_review_for_paper_roll
  on public.print_jobs (kiosk_id) where status = 'needs_review';

alter table public.print_paper_roll_events enable row level security;

revoke all on table public.print_paper_roll_events from public, anon, authenticated;
grant select, insert on table public.print_paper_roll_events to service_role;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'senhahub_service') then
    execute 'grant select, insert on table public.print_paper_roll_events to senhahub_service';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'print_paper_roll_events'
        and policyname = 'senhahub_service_backend_access'
    ) then
      execute 'create policy senhahub_service_backend_access on public.print_paper_roll_events for all to senhahub_service using (true) with check (true)';
    end if;
  end if;
end
$do$;

comment on table public.print_paper_roll_events is
  'Append-only initialization and replacement history for printer paper roll counters.';
