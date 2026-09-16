# Plano de teste de carga do SenhaHub

**Estado:** preparado; nenhum tráfego de carga foi enviado.  
**Data da inspeção:** 2026-09-14.  
**Escopo:** repositório atual, sem acesso a URL/deploy ou projeto Supabase de homologação.

## Resultado da inspeção

O deploy descrito pelo repositório é uma aplicação Next.js na Vercel com região `gru1`. As páginas identificadas são `/`, `/login`, `/totem`, `/attendant`, `/admin`, `/admin/operacao`, `/admin/setores`, `/admin/totens`, `/admin/usuarios`, `/tablet`, `/tv/acougue` e `/acompanhar/:token`. Não encontrei Server Actions. As APIs são despachadas por `app/api/[...path]/route.js`, uma rota Node dinâmica com duração máxima configurada de 60 segundos. Assim, cada chamada `/api/*` passa pela mesma Function do catch-all; arquivos estáticos e páginas podem ser atendidos pelo CDN ou por renderização Next.js e precisam ser separados no painel da Vercel.

O navegador chama a API do próprio SenhaHub. As chamadas ao Supabase estão no servidor (`supabase-runtime.js`), que usa Auth, PostgREST e RPC com credenciais mantidas no backend. O script k6 não recebe nem usa `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, token de usuário, cookie de sessão ou credencial Vercel. O único segredo cliente exigido é a senha das contas sintéticas, fornecida por variável de ambiente no computador que executará k6; o login gera cookies de sessão e CSRF por usuário.

As telas operacionais não usam Supabase Realtime diretamente. O cliente consulta `/api/state` a cada 20 segundos; atendente usa `EventSource` em `/api/events?scope=staff`, com reconexões automáticas, recorrendo a polling de `/api/staff/state` a cada 5 segundos em caso de falha; a TV e o tablet consultam o estado a cada 5 segundos; o gestor atualiza filas e métricas a cada 30 segundos; e o acompanhamento QR consulta a senha a cada 10 segundos. O totem atualiza o estado a cada 10 segundos enquanto seleciona setor. O agente de impressão v2 pode usar Supabase Realtime ou SSE, conforme a configuração do dispositivo. Essas conexões do agente devem ser medidas separadamente das requisições HTTP e mensagens de fila.

Não encontrei renovação periódica de sessão no frontend. A sessão da aplicação tem validade de 12 horas; os fluxos usam `/api/auth/login`, `/api/auth/me` e `/api/auth/logout`. Requisições de leitura das rotas operacionais também podem tentar executar jobs agendados, limitados por uma janela de 15 segundos por instância. Em Vercel com várias instâncias, contabilize esses RPCs como atividade interna do runtime, não como ação de usuário.

## Rotas e operações por fluxo

| Fluxo | Ações encontradas | Cadência no código | Supabase/Realtime e ressalvas |
|---|---|---|---|
| Cliente PWA | `GET /login`, `POST /api/auth/login`, `GET /`, `GET /api/auth/me`, `POST /api/sessions`, `GET /api/state`, `POST /api/tickets` | `/api/state` inicial e depois a cada 20 s enquanto a tela está visível | Auth + PostgREST/RPC pelo servidor; sem Realtime direto. Cada senha é vinculada a uma conta sintética única. |
| Totem | `GET /totem`, `GET /api/kiosk/status`, `POST /api/kiosk/tickets`, `GET /api/kiosk/print-jobs/:id` | Status a cada 10 s na seleção; consulta do trabalho de impressão a cada 1,2 s enquanto pendente | A emissão cria senha e trabalho na fila de impressão. Só habilitar o fluxo k6 após confirmar que nenhum agente/impressora física está conectado ao staging. Limite de emissão do código: 12 por totem/minuto. |
| Atendente | `GET /attendant`, login/me, `GET /api/staff/state`, `GET /api/events?scope=staff`, `POST /api/sectors/:sectorId/call-next`, `POST /api/tickets/:id/confirm`, `POST /api/tickets/:id/finish` e `POST /api/tickets/:id/skip` | SSE com reconexão do cliente; polling de estado a cada 5 s quando o SSE falha; ações por interação | `/api/events` é SSE da aplicação, não Supabase Realtime. O modo de carga só chama/finaliza senhas com `ENABLE_STAFF_MUTATIONS=1` e setor exclusivo. |
| TV | `GET /tv/acougue`, `GET /api/display/state`, `GET /api/weather`, `GET /data/tv-playlist.json` | Estado 5 s; clima 25 min; playlist 5 min | `/api/weather` chama provedor externo; fica desabilitado no k6 por padrão para não gerar carga externa. Playlist vem de arquivo estático. |
| Tablet | `GET /tablet`, `GET /api/tablet/status` | Estado a cada 5 s enquanto o tablet está aguardando | Atualizações só de leitura; ações de emissão continuam por interação. |
| Gestor | `GET /admin`, login/me, `GET /api/staff/state`, `GET /api/metrics?date=...`, opcional `GET /api/users` | Dashboard/filas e métricas a cada 30 s; métricas têm cache de 60 s por instância | Carga de leitura. O fluxo de usuários só é incluído com `INCLUDE_MANAGER_USERS=1` e conta sintética autorizada. |
| Acompanhamento QR | `GET /acompanhar/:token`, `GET /api/tickets/track/:token` | Página consulta o token de acompanhamento a cada 10 s enquanto a senha não terminou | É um token assinado de QR/trabalho físico e não é devolvido pela criação digital. Requer senha física sintética no staging. Não é misturado ao fluxo cliente digital. |

No repositório não há evidência de leitura ou escrita direta ao banco pelo navegador. As queries e chamadas RPC internas do endpoint estão resumidas nos logs de saída Supabase que foram adicionados para requisições com run ID. Uma chamada PostgREST observada é uma requisição HTTP; uma RPC pode executar múltiplas instruções SQL, portanto a contagem exata de SQL deve vir também das métricas/estatísticas do banco.

## Instrumentação preparada

O backend já registrava `request.started` e `request.finished` com método, rota, status, `requestId` e duração. Agora, quando `LOAD_TEST_INSTRUMENTATION_ENABLED=1` estiver configurado no backend de teste e o cliente enviar um `X-Load-Test-Run-Id` válido:

- os logs da aplicação incluem `load_test_run_id`, usuário sintético autenticado, senha associada à operação quando aplicável, ambiente, runtime, região e identificador do deploy;
- cada chamada de saída ao Supabase gera `supabase.request.finished`, com request ID correlacionável, método, rota sanitizada sem query/valores, tipo (Auth, PostgREST, RPC, Storage, Edge Function ou Realtime), status, duração e bytes aproximados;
- eventos de auditoria relacionados a senhas armazenam `load_test_run_id` no JSON `payload`, permitindo localizar as operações sem alterar o esquema de `tickets`;
- corpos, cookies, tokens, e-mails, senhas e chaves não são gravados nesses logs.

Habilite essa variável apenas no deploy de staging escolhido para o teste. O teste de instrumentação verifica que cabeçalhos malformados são ignorados e que a coleta só é ativada por configuração explícita. O `requestId` pode ser cruzado com `x-vercel-id` nos logs do Vercel. A emissão do totem cria uma senha sintética e um trabalho pendente, mas não aciona impressora enquanto o agente estiver desativado.

## Cenário principal e volume esperado

O modo principal do script usa `constant-arrival-rate`: 200 sessões digitais iniciadas em 1 hora (200 iterações totais; média de 3,33/min). Cada iteração usa uma das 200 contas sintéticas, inicia uma sessão, emite uma senha no setor exclusivo e acompanha estado por 120 segundos, consultando a API a cada 20 segundos. Isso resulta em cerca de 6 a 7 sessões digitais ativas ao mesmo tempo; não equivale a 200 usuários simultâneos.

Para esses parâmetros, o script deve gerar **2.200 chamadas de API** e **400 requisições de página** (login e PWA) mais uma chamada de readiness: aproximadamente **2.601 requisições da aplicação contabilizadas pelo k6**, sem contar assets CSS/JS/imagens, prefetch do navegador, requests do CDN que a ferramenta HTTP não executa e atividades dos dispositivos de apoio. Em relação à cadência anterior de 12 s, são cerca de **27% menos chamadas de API** neste cenário. A composição esperada é:

| Camada | Rota ou operação | Chamadas esperadas | Chamadas observadas | Diferença | Observações |
|---|---|---:|---:|---:|---|
| k6 | `GET /api/ready` | 1 | pendente | pendente | Pré-checagem única, fora das 200 sessões. |
| Cliente | `GET /login` e `GET /` | 400 | pendente | pendente | 2 páginas por sessão; os assets não são carregados pelo script HTTP. |
| Vercel/API | `POST /api/auth/login` | 200 | pendente | pendente | 1 por conta; conta Auth e rate limits do staging também precisam ser monitorados. |
| Vercel/API | `GET /api/auth/me` | 200 | pendente | pendente | 1 por sessão autenticada. |
| Vercel/API | `POST /api/sessions` | 200 | pendente | pendente | Upsert de dispositivo/sessão do cliente. |
| Vercel/API | `GET /api/state` | 1.400 | pendente | pendente | 1 inicial + 6 consultas de polling por usuário em 120 s. |
| Vercel/API | `POST /api/tickets` | 200 | pendente | pendente | Espera-se HTTP 201 por senha nova; 200 pode significar emissão já existente. |
| Supabase/Auth | Chamadas Auth geradas pelos endpoints acima | Fanout a medir | pendente | pendente | A instrumentação registra cada chamada HTTP; comparar também com Auth Usage. |
| Supabase/PostgREST | SELECT/INSERT/UPDATE e RPCs desses endpoints | Fanout a medir | pendente | pendente | Contagem HTTP observada nos logs; instruções SQL internas das RPCs exigem métrica do banco. |
| Realtime | WebSocket/mensagens do cliente, atendente e TV | 0 diretas | pendente | pendente | Nessas telas o transporte observado é polling/SSE; conexões do agente de impressão ficam separadas. |

Fórmulas usadas: `200 × 1` para cada ação única; estado = `200 × (1 + teto(120/20)) = 1.400`; API = login + auth/me + sessão + estado inicial + emissão + polling = `200 × 11 = 2.200`. Total k6 = `2.200 API + 400 páginas + 1 readiness = 2.601`. Este valor não é o total Vercel de assets/CDN nem o número de queries SQL. Mudanças na duração da sessão, cadência de polling, retries ou abas em segundo plano alteram a estimativa.

Os fluxos `tv`, `attendant` e `manager` podem rodar como cenários auxiliares em processos k6 separados e com o mesmo `LOAD_TEST_RUN_ID`: valores iniciais propostos são 1 TV, 2 atendentes e 1 gestor durante a hora. Eles são carga de dispositivos/equipe e não entram nos 200 clientes.

| Fluxo auxiliar | Volume esperado em 1 hora | Observação |
|---|---:|---|
| TV (1 VU) | ~720 `GET /api/display/state`; ~12 playlists estáticas; 2 páginas | Cadência de estado 5 s; clima não é consultado por padrão; login e readiness ocorrem uma vez. |
| Atendente (2 VUs) | ~2.400 `GET /api/events?scope=staff`; 4 páginas e 2 estados iniciais | O evento SSE é requisitado aproximadamente a cada 3 s por VU. Polling de fallback não ocorre no cenário normal. |
| Gestor (1 VU) | ~120 `GET /api/staff/state` + ~120 `GET /api/metrics`; 2 páginas | Cadência de atualização 30 s. Usuários entram uma vez com `INCLUDE_MANAGER_USERS=1`. Cache interno pode reduzir chamadas Supabase, não as chamadas HTTP da aplicação. |
| Totem (1 VU, opcional) | Até ~200 status + ~200 emissões + ~200 leituras do trabalho de impressão | Aproximação com intervalo de 18 s; agente/impressora física precisa estar desligado. Limite do backend é 12 emissões/minuto. |

São aproximações de iterações, antes de latência e requests interrompidos. O atendente executa apenas leituras por padrão; chamadas e finalizações são opt-in e exigem setor sintético exclusivo. Para cada linha, chamadas Supabase são contadas pelos logs por fanout observado, e não assumidas como um SELECT por request.

Para uma projeção mensal de 30 dias com cada tela aberta durante as 12 horas de funcionamento: uma TV faz cerca de **259.200** consultas de estado por mês, ante 648.000 na cadência anterior; um tablet continuamente aguardando tem o mesmo volume. Um gestor com uma aba aberta faz cerca de **86.400** consultas entre estado e métricas, ante 216.000. Para os clientes, a leitura de estado cai de 5 para 3 por minuto: com 700 senhas/dia, cada minuto médio de acompanhamento por senha representa aproximadamente 63.000 leituras mensais (seriam 105.000 antes); com dois minutos médios, 126.000 em vez de 210.000. São estimativas de chamadas HTTP do app, sem contar assets ou o fanout interno do Supabase.

O modo de pico usa `ramping-vus`: subida gradual até 200, permanência de 12 minutos e redução gradual. O script configura 5 minutos de subida e 5 de redução, para duração total aproximada de 22 minutos. Cada VU de pico autentica uma conta sintética própria e acompanha seu estado; não se deve somar esse cenário aos resultados principais.

## Métricas e atribuição por camada

O k6 produz chamadas/segundo, requisições por rota, média, p50, p95, p99, máximo, taxa de sucesso/erro, 4xx, 5xx, 429, timeouts, bytes enviados/recebidos, VUs ativos e iterações interrompidas. `senhahub_route_latency` separa rotas críticas de consultas simples. Para reconexões, o cenário atendente repete a chamada SSE e conta tentativas; isso é uma estimativa de reconnect do navegador, não conexão Supabase Realtime.

No Vercel, filtre logs por `load_test_run_id` e registre URL do deploy, ID do deploy, commit SHA e região. Compare separadamente: requests recebidos, invocações da Function catch-all, páginas/SSR/RSC, APIs, CDN/assets, erros, duração, timeouts, cold starts, CPU, memória e transferência quando o plano disponibilizar. Um request de página, um hit do CDN e uma invocação de Function são métricas diferentes; Web Analytics não substitui contagem de APIs.

No Supabase, registre Auth, chamadas PostgREST/RPC, Storage/Edge Functions caso apareçam, duração e bytes dos eventos `supabase.request.finished`, conexões/CPU/memória do banco, pool/conexões ativas, Query Performance, erros RLS/Auth, 429, egress e métricas do Realtime. Compare intervalo imediatamente antes, durante e depois; os painéis agregados podem não atribuir cada query individual ao run ID.

O painel Realtime deve ser separado: conexões persistentes e mensagens não são requisições PostgREST. A UI cliente/TV/atendente atual usa HTTP/SSE/polling. Para testar o WebSocket Supabase de impressão é necessário instrumentar/executar o agente v2 sintético e comparar conexões, mensagens, desconexões e reconexões no painel do Supabase; o k6 principal não o simula.

## Execução após receber os dados pendentes

Pré-condições: URL Preview/staging e ID do deploy; projeto Supabase separado com seu project ref; setor/fila exclusivos; 200 contas `customer` sintéticas ativas com senha segura comum guardada fora do Git; conta sintética de atendente, TV e gestor com permissões mínimas; conta/totem sintético pareado se for testar emissão física; configuração `LOAD_TEST_INSTRUMENTATION_ENABLED=1` somente nesse deploy; confirmação de jobs, push, webhook e agente de impressão desligados. Nunca cadastrar `service_role_key` no k6. A URL deve ser comparada manualmente com o deploy e projeto Supabase antes do smoke test.

O k6 usa `BASE_URL`, `STAGING_URL` idênticas, `TARGET_ENV=staging` e `CONFIRM_STAGING_TARGET=yes` como barreiras de execução; também recusa o domínio público `senhahub.vercel.app`. Essas verificações complementam, mas não substituem, a validação manual do deploy e do Supabase. As contas podem seguir o padrão `CUSTOMER_EMAIL_TEMPLATE=senhahub-load-{n}`, `CUSTOMER_EMAIL_DOMAIN=example.test`; os 200 usuários devem ser criados previamente no projeto Supabase descartável por procedimento administrativo seguro. O script não cria contas e não chama Auth Admin.

Exemplos de comandos preparados (não executados):

```sh
# Smoke: cinco sessões sintéticas simultâneas, cada uma acompanhada por três minutos.
k6 run -e FLOW=customer -e MODE=smoke \
  -e BASE_URL="$SENHAHUB_STAGING_URL" -e STAGING_URL="$SENHAHUB_STAGING_URL" -e TARGET_ENV=staging \
  -e CONFIRM_STAGING_TARGET=yes -e LOAD_TEST_RUN_ID="$LOAD_TEST_RUN_ID" \
  -e SECTOR_ID="$LOAD_TEST_SECTOR_ID" \
  -e CUSTOMER_EMAIL_TEMPLATE=senhahub-load-{n} \
  -e CUSTOMER_EMAIL_DOMAIN=example.test \
  -e CUSTOMER_PASSWORD="$SENHAHUB_LOADTEST_PASSWORD" \
  load-test/k6/senhahub.js

# Principal: 200 clientes únicos distribuídos por uma hora.
k6 run -e FLOW=customer -e MODE=main \
  -e BASE_URL="$SENHAHUB_STAGING_URL" -e STAGING_URL="$SENHAHUB_STAGING_URL" -e TARGET_ENV=staging \
  -e CONFIRM_STAGING_TARGET=yes -e LOAD_TEST_RUN_ID="$LOAD_TEST_RUN_ID" \
  -e SECTOR_ID="$LOAD_TEST_SECTOR_ID" \
  -e CUSTOMER_EMAIL_TEMPLATE=senhahub-load-{n} \
  -e CUSTOMER_EMAIL_DOMAIN=example.test \
  -e CUSTOMER_PASSWORD="$SENHAHUB_LOADTEST_PASSWORD" \
  load-test/k6/senhahub.js

# Pico opcional: ramp-up até 200 VUs, 12 min no pico e ramp-down.
k6 run -e FLOW=customer -e MODE=peak \
  -e BASE_URL="$SENHAHUB_STAGING_URL" -e STAGING_URL="$SENHAHUB_STAGING_URL" -e TARGET_ENV=staging \
  -e CONFIRM_STAGING_TARGET=yes -e LOAD_TEST_RUN_ID="$LOAD_TEST_RUN_ID" \
  -e SECTOR_ID="$LOAD_TEST_SECTOR_ID" \
  -e CUSTOMER_EMAIL_TEMPLATE=senhahub-load-{n} \
  -e CUSTOMER_EMAIL_DOMAIN=example.test \
  -e CUSTOMER_PASSWORD="$SENHAHUB_LOADTEST_PASSWORD" \
  load-test/k6/senhahub.js
```

Contas das equipes e dispositivos auxiliares usam `FLOW=attendant|tv|manager`, `MODE=background`, suas próprias variáveis `*_EMAIL`/`*_PASSWORD`, `VUS` e `DURATION`. Para o atendente, a emissão/atualização/finalização só acontece com `ENABLE_STAFF_MUTATIONS=1` e `SECTOR_ID` exclusivo. Para o totem, além de `FLOW=kiosk`, configure `KIOSK_COOKIE` da sessão sintética e defina `ENABLE_KIOSK_ISSUANCE=yes` e `CONFIRM_PRINT_AGENT_DISABLED=yes`; sem confirmação de agente físico desligado, a configuração bloqueia a emissão. A senha/cookie deve ser injetada no ambiente local sem aparecer em arquivo versionado, relatório ou saída de terminal.

Ordem: (1) validar deploy, projeto Supabase e isolamento; (2) tirar snapshots de métricas e confirmar jobs/notificações/impressão desabilitados; (3) smoke de cinco usuários/3 min; (4) validar logs por run ID, cookies/Auth, eventos, fila e ausência de duplicação; (5) coletar snapshots do Supabase e Vercel; (6) principal de 200/60 min; (7) verificar os eventos de senha e ausência de vazamento entre setores com as consultas somente de leitura em `load-test/verify-run.sql`; (8) observar 10 min após a carga; (9) somente se os critérios passarem, executar o pico; (10) qualquer limpeza posterior deve selecionar apenas IDs/usuários sintéticos associados ao `load_test_run_id` e ser revisada antes de aplicar.

## Critérios de avaliação

Aplicar os critérios iniciais fornecidos: zero perda/duplicação; zero violação RLS ou vazamento entre usuários/setores; zero 5xx inesperado e 429 no cenário normal; erros abaixo de 1%; p95 abaixo de 1,5 s para operações críticas e 1 s para consultas simples; zero timeout crítico; recuperação correta de SSE/Realtime aplicável; disponibilidade de pelo menos 99%; sem saturação de conexões do banco ou limite de duração das Functions; operação normal após a execução. Registrar exceções separadas por cenário e rota.

## Modelo de relatório pós-execução

| Item | Resultado |
|---|---|
| Ambiente, URL e região | A preencher após identificar staging |
| Commit, deployment ID e Supabase project ref | A preencher após validar o alvo |
| Run ID, datas e configuração | A preencher |
| Usuários, sessões, iterações e duração | A preencher |
| Requests k6: total, por rota, RPS, bytes | A preencher |
| Vercel: requests, Functions, CDN, erros, duração/cold starts | A preencher |
| Supabase: Auth, PostgREST/RPC, SQL, conexões, CPU, egress | A preencher |
| SSE/Realtime: conexões, mensagens, reconexões | A preencher; separar transportes |
| Latência média/p50/p95/p99/máxima | A preencher |
| 4xx/5xx/429/timeouts e taxa de erro | A preencher |
| Integridade da fila e duplicação/perda | A preencher via eventos e IDs de senha sintéticos |
| Gargalos, critérios aprovados/reprovados e ações | A preencher |

Os gráficos de latência, erros e volume devem ser gerados a partir do JSON/CSV de saída do k6 e dos snapshots de Vercel/Supabase no intervalo de teste. Não atribuir tráfego CDN, SQL de RPC ou mensagens Realtime com base apenas nos logs de aplicação.

## Informações pendentes para executar

1. URL do deploy Vercel de staging, ID do deploy/commit e confirmação de que não é produção.
2. Supabase project ref separado e confirmação de migrações/RLS/configuração do staging.
3. ID do setor de teste exclusivo e seu estado de abertura.
4. Confirmação de que jobs automáticos, push, webhooks e impressora/agente físico estão desativados ou apontam para simuladores.
5. 200 contas sintéticas `customer` preparadas; senha enviada ao executor por variável segura local, nunca nesta conversa ou no repositório.
6. Credenciais/IDs sintéticos mínimos de atendente, TV e gestor; cookie de totem sintético apenas se for executar esse fluxo.
7. Janela de teste aprovada pelo responsável do staging e usuário autorizado a consultar os painéis Vercel/Supabase durante e depois do teste.
8. Executor com k6 instalado; este workspace não possui o binário k6, então o script foi validado por análise sintática, mas não executado.

Sem os itens 1–4 e as contas do cenário, não execute os comandos. Não há coleta de tráfego nem acesso a produção nesta preparação.
