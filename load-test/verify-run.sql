-- Consultas somente de leitura. Substitua o marcador pelo run ID do teste.
-- Execute apenas no projeto Supabase isolado de staging.

-- 1. Totais de eventos de emissão versus senhas únicas associadas ao run.
with run_issuance as (
  select
    entity_id,
    customer_id,
    sector_id,
    type,
    created_at
  from public.events
  where payload ->> 'load_test_run_id' = '__LOAD_TEST_RUN_ID__'
    and entity_type = 'ticket'
    and type in ('senha_emitida', 'senha_fisica_emitida')
)
select
  count(*) as issuance_events,
  count(distinct entity_id) as distinct_ticket_ids,
  count(distinct customer_id) filter (where customer_id is not null) as distinct_customer_ids,
  min(created_at) as first_issuance_at,
  max(created_at) as last_issuance_at
from run_issuance;

-- 2. Senhas emitidas mais de uma vez no mesmo setor pelo run.
-- Linhas retornadas exigem investigação; um retry de API pode repetir um evento
-- sem duplicar a senha, então compare também o COUNT(DISTINCT entity_id) acima.
select
  customer_id,
  sector_id,
  count(*) as issuance_events,
  count(distinct entity_id) as distinct_ticket_ids
from public.events
where payload ->> 'load_test_run_id' = '__LOAD_TEST_RUN_ID__'
  and entity_type = 'ticket'
  and type in ('senha_emitida', 'senha_fisica_emitida')
group by customer_id, sector_id
having count(*) > 1
order by issuance_events desc;

-- 3. Eventos do run que apontam para uma senha ausente.
select e.entity_id as missing_ticket_id, e.type, e.created_at
from public.events e
left join public.tickets t on t.id::text = e.entity_id
where e.payload ->> 'load_test_run_id' = '__LOAD_TEST_RUN_ID__'
  and e.entity_type = 'ticket'
  and e.type in ('senha_emitida', 'senha_fisica_emitida')
  and t.id is null
order by e.created_at;

-- 4. Status final das senhas pertencentes às emissões rastreadas.
with run_tickets as (
  select distinct entity_id
  from public.events
  where payload ->> 'load_test_run_id' = '__LOAD_TEST_RUN_ID__'
    and entity_type = 'ticket'
    and type in ('senha_emitida', 'senha_fisica_emitida')
)
select t.status, count(*) as tickets
from public.tickets t
join run_tickets rt on rt.entity_id = t.id::text
group by t.status
order by t.status;
