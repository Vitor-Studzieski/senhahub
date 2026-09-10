-- Historical physical tickets from totem-pompeia-01 belong to Loja 2.
-- Preserve IDs, statuses, customers and timestamps while aligning the
-- ticket sector and all ticket-linked operational history.

begin;

create temporary table senhahub_store2_ticket_map on commit drop as
select
  id,
  sector_id as old_sector_id,
  case sector_id
    when 'acougue-loja-1' then 'acougue-loja-2'
    when 'frios-loja-1' then 'frios-loja-2'
    when 'padaria-loja-1' then 'padaria-loja-2'
  end as new_sector_id
from public.tickets
where source = 'physical'
  and kiosk_id = 'totem-pompeia-01'
  and sector_id in ('acougue-loja-1', 'frios-loja-1', 'padaria-loja-1');

update public.calls c
set sector_id = m.new_sector_id
from senhahub_store2_ticket_map m
where c.ticket_id = m.id
  and c.sector_id is distinct from m.new_sector_id;

update public.services s
set sector_id = m.new_sector_id
from senhahub_store2_ticket_map m
where s.ticket_id = m.id
  and s.sector_id is distinct from m.new_sector_id;

update public.events e
set sector_id = m.new_sector_id
from senhahub_store2_ticket_map m
where e.entity_type = 'ticket'
  and e.entity_id = m.id::text
  and e.sector_id is distinct from m.new_sector_id;

update public.print_jobs p
set payload = replace(replace(replace(
  p.payload::text,
  'acougue-loja-1', 'acougue-loja-2'),
  'frios-loja-1', 'frios-loja-2'),
  'padaria-loja-1', 'padaria-loja-2')::jsonb
where p.kiosk_id = 'totem-pompeia-01'
  and (
    p.payload::text like '%acougue-loja-1%'
    or p.payload::text like '%frios-loja-1%'
    or p.payload::text like '%padaria-loja-1%'
  );

update public.tickets t
set sector_id = m.new_sector_id
from senhahub_store2_ticket_map m
where t.id = m.id
  and t.sector_id is distinct from m.new_sector_id;

commit;
