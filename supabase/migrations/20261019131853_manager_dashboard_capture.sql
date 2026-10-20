-- Store operational, team, accessibility, and digital-channel signals used by
-- the six manager dashboards. Historical rows stay unclassified where the
-- source system did not capture the information.
begin;

create table if not exists public.stores (
  store_code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_code_format check (store_code ~ '^loja-[0-9]+$'),
  constraint stores_name_length check (char_length(name) between 1 and 120)
);

insert into public.stores (store_code, name)
values ('loja-1', 'Loja 1'), ('loja-2', 'Loja 2')
on conflict (store_code) do nothing;

alter table public.sectors add column if not exists store_code text;
update public.sectors
set store_code = 'loja-1'
where store_code is null or btrim(store_code) = '';
insert into public.stores (store_code, name)
select distinct store_code, 'Loja ' || split_part(store_code, '-', 2)
from public.sectors
where store_code ~ '^loja-[0-9]+$'
on conflict (store_code) do nothing;
alter table public.sectors alter column store_code set default 'loja-1';
alter table public.sectors alter column store_code set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sectors'::regclass
      and conname = 'sectors_store_code_stores_fkey'
  ) then
    alter table public.sectors
      add constraint sectors_store_code_stores_fkey
      foreign key (store_code) references public.stores(store_code);
  end if;
end;
$$;

alter table public.tickets
  add column if not exists origin_channel text not null default 'unknown',
  add column if not exists cancellation_reason text;
update public.tickets
set origin_channel = 'kiosk'
where source = 'physical' and kiosk_id is not null and origin_channel = 'unknown';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tickets'::regclass and conname = 'tickets_origin_channel_valid') then
    alter table public.tickets add constraint tickets_origin_channel_valid
      check (origin_channel in ('app', 'qr', 'web', 'kiosk', 'panel', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tickets'::regclass and conname = 'tickets_cancellation_reason_valid') then
    alter table public.tickets add constraint tickets_cancellation_reason_valid
      check (cancellation_reason is null or cancellation_reason in ('customer_request', 'operator_request', 'no_show', 'standby_expired', 'queue_reset', 'operational_error', 'duplicate', 'unknown'));
  end if;
end;
$$;

alter table public.calls
  add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.services
  add column if not exists attendant_id uuid references public.profiles(id) on delete set null;

alter table public.events
  add column if not exists actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists store_code text references public.stores(store_code) on delete set null,
  add column if not exists origin_channel text,
  add column if not exists idempotency_key text;
update public.events e
set store_code = s.store_code
from public.sectors s
where e.sector_id = s.id and e.store_code is null;
update public.events e
set origin_channel = t.origin_channel
from public.tickets t
where e.entity_type = 'ticket' and e.entity_id = t.id::text and e.origin_channel is null;
create unique index if not exists idx_events_idempotency_key
  on public.events (idempotency_key) where idempotency_key is not null;

alter table public.push_notification_events add column if not exists clicked_at timestamptz;
create index if not exists idx_push_notification_events_clicked_at
  on public.push_notification_events (clicked_at desc) where clicked_at is not null;

create or replace function public.set_ticket_origin_channel()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source = 'physical' and new.kiosk_id is not null and new.origin_channel = 'unknown' then
    new.origin_channel := 'kiosk';
  end if;
  return new;
end;
$$;
drop trigger if exists tickets_set_origin_channel on public.tickets;
create trigger tickets_set_origin_channel
before insert or update of source, kiosk_id on public.tickets
for each row execute function public.set_ticket_origin_channel();

create table if not exists public.staff_presence (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_code text not null references public.stores(store_code),
  sector_id text references public.sectors(id) on delete set null,
  status text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint staff_presence_status_valid check (status in ('available', 'break')),
  constraint staff_presence_range_valid check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists idx_staff_presence_one_open_period
  on public.staff_presence (profile_id) where ended_at is null;
create index if not exists idx_staff_presence_store_live
  on public.staff_presence (store_code, status, last_seen_at desc) where ended_at is null;
create index if not exists idx_staff_presence_sector_live
  on public.staff_presence (sector_id, status, last_seen_at desc) where ended_at is null;

create table if not exists public.service_accessibility_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  sector_id text references public.sectors(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  support_code text not null,
  action text not null,
  occurred_at timestamptz not null default now(),
  constraint accessibility_support_code_valid check (support_code in ('libras', 'texto_visual', 'modo_silencioso', 'audio', 'mobilidade', 'outro')),
  constraint accessibility_action_valid check (action in ('requested', 'provided', 'unavailable'))
);
create unique index if not exists idx_service_accessibility_event_once
  on public.service_accessibility_events (ticket_id, support_code, action)
  where ticket_id is not null;
create index if not exists idx_service_accessibility_sector_time
  on public.service_accessibility_events (sector_id, occurred_at desc);

create table if not exists public.service_sla_targets (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(store_code),
  sector_id text references public.sectors(id) on delete cascade,
  target_wait_seconds integer,
  target_service_seconds integer,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_sla_target_positive check (
    (target_wait_seconds is null or target_wait_seconds > 0)
    and (target_service_seconds is null or target_service_seconds > 0)
    and (target_wait_seconds is not null or target_service_seconds is not null)
  )
);
create unique index if not exists idx_service_sla_targets_scope
  on public.service_sla_targets (store_code, coalesce(sector_id, '*')) where active;

create table if not exists public.store_operating_costs (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(store_code),
  attendant_hourly_cost numeric(10,2) not null,
  valid_from date not null default (now() at time zone 'America/Sao_Paulo')::date,
  valid_until date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint store_cost_positive check (attendant_hourly_cost > 0),
  constraint store_cost_period_valid check (valid_until is null or valid_until >= valid_from)
);
create unique index if not exists idx_store_operating_costs_current
  on public.store_operating_costs (store_code) where valid_until is null;

create table if not exists public.manager_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  recommendation_code text,
  status text not null default 'planned',
  priority text not null default 'medium',
  store_code text references public.stores(store_code) on delete set null,
  sector_id text references public.sectors(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_action_title_length check (char_length(title) between 1 and 160),
  constraint manager_action_description_length check (description is null or char_length(description) <= 1000),
  constraint manager_action_status_valid check (status in ('planned', 'in_progress', 'done', 'dismissed')),
  constraint manager_action_priority_valid check (priority in ('low', 'medium', 'high'))
);
create index if not exists idx_manager_actions_status_due
  on public.manager_actions (status, due_at nulls last, created_at desc);
create index if not exists idx_manager_actions_store_sector
  on public.manager_actions (store_code, sector_id, status);

-- All analytics and management tables are server-only. The application writes
-- through its authenticated server, never directly from browser clients.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'stores', 'staff_presence', 'service_accessibility_events',
    'service_sla_targets', 'store_operating_costs', 'manager_actions'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
    execute format('drop policy if exists senhahub_deny_external_access on public.%I', v_table);
    execute format(
      'create policy senhahub_deny_external_access on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table
    );
    if exists (select 1 from pg_roles where rolname = 'senhahub_service') then
      execute format('grant select, insert, update, delete on table public.%I to senhahub_service', v_table);
      execute format('drop policy if exists senhahub_service_backend_access on public.%I', v_table);
      execute format(
        'create policy senhahub_service_backend_access on public.%I for all to senhahub_service using (true) with check (true)',
        v_table
      );
    end if;
  end loop;
end;
$$;

comment on column public.tickets.origin_channel is
  'Explicit acquisition channel; unknown is retained when older clients did not report a source.';
comment on column public.tickets.cancellation_reason is
  'Terminal reason. Customer cancellation, no-show, reset, and operational error remain distinct.';
comment on table public.staff_presence is
  'Available and break periods reported by staff from the attendant workspace; stale heartbeats are not considered active.';
comment on table public.service_accessibility_events is
  'Support requested or delivered during a service. Records service accommodations, not a customer diagnosis.';
comment on table public.manager_actions is
  'Manager follow-up items and completion state for operational recommendations.';

notify pgrst, 'reload schema';

commit;
