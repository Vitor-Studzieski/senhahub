# Captação das dashboards do gestor

## Estado

- A migration `20261019131853_manager_dashboard_capture.sql` foi aplicada ao projeto remoto SenhaHub; o arquivo local usa a mesma versão registrada.
- O runtime Supabase e as telas locais estão instrumentados para usar as novas colunas e tabelas.
- As seis tabelas novas têm RLS habilitado e acesso negado para `anon`/`authenticated`; a aplicação acessa os dados pelo backend.
- Nenhum dado fictício das imagens de referência foi inserido.

## Verificação do destino

O `.env` aponta para o projeto Supabase `SenhaHub` (`hbtyvtfiwxfubichdext`), usado no modo local atual. A migration preencheu `stores` a partir dos códigos existentes `loja-1` e `loja-2`, sem inferir nomes comerciais.

Depois da aplicação, o histórico remoto lista 27 migrations. O diretório local contém 42 arquivos: 26 nomes também aparecem no remoto, 11 deles com timestamps diferentes; há 16 arquivos apenas locais e um registro remoto sem arquivo local correspondente. A consulta de catálogo ao projeto confirmou:

- As tabelas centrais (`profiles`, `sectors`, `tickets`, `calls`, `services`, `ratings`, `events`) e os campos essenciais do fluxo atual existem. `app_sessions`, `cron_executions`, `print_job_attempts`, `tv_media` e os campos de totem/loja também existem, embora algumas migrations locais correspondentes não constem no histórico remoto.
- Os cinco índices de métricas diárias e os índices de observabilidade já estão no banco. O tipo de papel inclui `tablet` e `marketing`; a tabela `tv_media` existe.
- `call_next_ticket` já usa o contador de preferência e a migration posterior de chamadas múltiplas; `finish_print_job_v2` contém a resolução idempotente de conflito de resultado impresso.
- As migrations `local_runtime_role_grants`, `local_auth_password_resets`, `local_runtime_nobypassrls` e `local_postgres_runtime_reconciliation` são específicas do runtime Postgres local; a última instrui expressamente que não seja aplicada ao Supabase hospedado.
- As migrations de bloqueio de login e bobinas de impressão têm objetos ainda ausentes (`record_login_failure` e `print_paper_roll_events`). Não são pré-requisitos para captação gerencial e não serão reaplicadas junto com esta migration.
- A migration remota com nome `20260924121147_print_enrollment_30_minute_ttl` tem equivalente local com outro timestamp. Essa divergência de histórico continua registrada, sem edição manual da tabela de migrations.

A comparação foi registrada antes da aplicação. A migration foi executada isoladamente como versão `20261019131853` e conferida depois: as seis tabelas novas existem, com RLS e policy de bloqueio externo; os campos de canal, encerramento, responsável, loja e clique também existem. Na conferência, havia 250 senhas: 188 com canal `kiosk` comprovado por origem física e vínculo ao totem; 62 ficaram como origem desconhecida. As tabelas de presença, acessibilidade, metas, custos e ações estavam vazias imediatamente após o preparo, como esperado. A divergência de histórico das outras migrations continua pendente; não use `db push` até reconciliá-la.

## Conferência do Pitch Day

Os registros operacionais do banco para `pitch-day` em 17/10 não coincidem com o relatório validado: 133 senhas (9 preferenciais, 1 status final atendida, 3 aguardando, 129 canceladas), 93 marcadas como origem kiosk e 40 sem origem classificada; o histórico `calls` contém 5 senhas com chamada e 4 intervalos. O relatório validado registra 131 senhas, 8 preferenciais, 1 atendida no status final, 6 aguardando, 124 canceladas, 91 totem, 40 digitais QR/app, 105 com chamada e 103 intervalos.

Os registros existentes não foram alterados nem descartados. Na data do Pitch Day, os indicadores operacionais que divergem ficam suspensos na interface; ela mostra o relatório validado e informa a diferença até que as fontes possam ser reconciliadas. A contagem de no-show também fica indisponível quando os motivos de cancelamento não estão classificados por completo.

## Dados que passam a ser registrados

| Informação | Fonte | Regra de leitura |
| --- | --- | --- |
| Loja e setor | `stores`, `sectors.store_code` | Emissões e alertas são agrupados pela unidade vinculada ao setor. |
| Canal da senha | `tickets.origin_channel` | `app`, `qr`, `web`, `kiosk`, `panel` ou `unknown`; dados antigos sem origem confiável continuam `unknown`. |
| Motivo de encerramento | `tickets.cancellation_reason` | Pedido do cliente, atendente, no-show, espera expirada, zeramento, erro, duplicada ou desconhecido. Cancelamento não significa abandono automaticamente. |
| Chamadas e responsável | `calls.actor_id`, `services.attendant_id` | Permite medir sequência de chamadas e produção por atendente. O intervalo é calculado por setor, sem misturar filas diferentes. |
| Presença | `staff_presence` | Registra disponível/pausa, loja, setor e heartbeat; um registro sem heartbeat recente não conta como presença ativa. |
| Recursos acessíveis | `service_accessibility_events` | Registra recurso solicitado, fornecido ou indisponível, associado à senha/atendimento. Não armazena diagnóstico. |
| Notificações abertas | `push_notification_events.clicked_at` | Conta abertura registrada pelo clique da notificação, sem inferir leitura quando não há evento. |
| Ações do gestor | `manager_actions` | Guarda responsável opcional, prioridade, prazo, status e conclusão. |
| Metas e custos | `service_sla_targets`, `store_operating_costs` | Configuração por loja/setor; nenhuma meta ou custo é presumido. |

## Limites das métricas

- Uma página aberta a partir de QR é uma visita registrada, não a comprovação de um scan único.
- O navegador informa instalação PWA; isso não equivale a downloads em lojas de aplicativos.
- Não há atribuição individual de conversão quando visita e emissão não compartilham uma identidade consentida.
- Previsão de demanda e economia potencial permanecem indisponíveis até existir histórico suficiente e uma linha de base operacional/custo.
- O relatório do Pitch Day de 17/10/2026 é mantido como agregado validado: 131 senhas, 91 totem, 40 digitais QR/app, 123 normais, 8 preferenciais, 105 com chamada, 6 aguardando e 124 canceladas. Os 26 cancelamentos do zeramento permanecem dentro dos 124. Os 103 intervalos entre chamadas têm mediana de 47 s, média de 1 min 53 s, p90 de 2 min 43 s e máximo de 32 min 24 s.
- Esse relatório não é usado para preencher as tabelas de eventos futuros nem para atribuir origem/horário/loja que não aparecem na fonte.
