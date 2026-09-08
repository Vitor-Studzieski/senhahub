# Relatório de implantação controlada — protocolo de impressão v2

**Data da auditoria:** 2026-09-05 (UTC)  
**Projeto Supabase:** `hbtyvtfiwxfubichdext` — SenhaHub  
**Projeto Vercel:** `prj_ojM1AoV77k8os6DNPvPctigsCaq1` — `senhahub`  
**Commit local de referência:** `bf2852cf48bcaa1c01f39187192e2e09b063ebd8`

## Resultado

| Área | Estado | Evidência |
|---|---|---|
| Auditoria inicial | concluído | histórico remoto revisado; não foi usado `supabase db push` |
| Migração Supabase v2 | concluído | `supabase_apply_migration` retornou `success: true` |
| Compatibilidade v1 | concluído | 118/118 jobs continuam `protocol_version=1`; 1/1 totem continua no protocolo 1 |
| Backup pré-migração | concluído com escopo | 118 linhas e metadados de `print_jobs`, criptografados fora do repositório |
| Publicação Vercel | concluído | deployment final `dpl_FTauNkNqxGk5xCCzcs8dT4knrDoX` em `READY`; alias `senhahub.vercel.app` |
| Build Vercel | concluído | Next.js compilado; 139 arquivos enviados (incluindo imagens essenciais); build concluído |
| Erros após publicação | sem evidência | consulta de logs de erro dos 15 minutos iniciais não retornou registros |
| Staging separado | pendente | nenhum projeto/ref de staging foi encontrado no diretório ou no vínculo atual |
| Cadastro/ativação de destinos v2 | pendente | produção ainda tem 0 impressoras e 0 dispositivos v2 cadastrados |
| Teste físico Bematech/Windows | pendente | depende do equipamento e da estação Windows |
| Teste físico Android | bloqueado | o ambiente disponível é Apple; APK e testes automatizados estão prontos |

## Estado do Supabase

Antes da migração, o banco tinha somente a estrutura v1: `print_jobs` com 118 registros (115 impressos e 3 falhos), sem `print_devices`, `print_printers`, funções v2 ou Realtime de impressão. A lista remota de migrations estava divergente da pasta local, por isso a aplicação foi feita somente para a migration `print_protocol_v2`.

Após a migração (registrada remotamente como `20260905125024_print_protocol_v2`), foram confirmados:

- relações `print_printers`, `print_devices`, `print_enrollments` e `print_job_attempts`;
- funções v2 de claim, lease, finish, recovery, resolução e provisionamento;
- RLS habilitado nas tabelas de impressão durável;
- 118 jobs v1, 0 jobs v2 e 0 dispositivos ativos;
- estados dos jobs preservados: 115 `printed` e 3 `failed`.

O catálogo `pg_cron` e `pg_net` não estão instalados no projeto. O sinal Realtime v2 usa broadcast privado; a validação ponta a ponta depende de um dispositivo cadastrado.

## Backup e rollback

O CLI não conseguiu executar um dump completo neste ambiente: `pg_dump` não está instalado e o hostname PostgreSQL não resolve a partir do shell. Antes da migração foi criado um backup lógico criptografado do escopo afetado:

- arquivo: `/private/tmp/senhahub-print-v2-backup-20260905T1245Z.json.enc`;
- chave separada: `/private/tmp/senhahub-print-v2-backup-20260905T1245Z.key`;
- permissões: 600;
- texto claro removido do repositório.

O backup contém os metadados da tabela e as 118 linhas originais de `public.print_jobs`. Para uma janela de produção futura, deve ser gerado também o dump completo externo com `supabase db dump` e restauração ensaiada.

Como a migração é aditiva e nenhum destino v2 foi ativado, o rollback operacional imediato é promover o deployment anterior `dpl_83TAdfegPjMijaoxeq4FiW4tWdoa` e manter os totens em v1. Restauração de dados deve usar o backup acima somente sob procedimento aprovado; não executar um `down` improvisado em produção.

## Estado do Vercel

O primeiro envio manual foi rejeitado depois do build porque o plano Hobby não aceita o cron a cada minuto (`cron_jobs_limits_reached`). O arquivo `vercel.json` foi ajustado para `0 3 * * *` (diário, 03:00 UTC). O deployment final `dpl_FTauNkNqxGk5xCCzcs8dT4knrDoX` ficou pronto com as imagens essenciais incluídas. O sweep frequente continua sendo feito pelos agentes; para sweep a cada minuto é necessário plano com Cron frequente ou scheduler externo autenticado.

O conector disponível não expõe leitura/gravação de variáveis de ambiente do projeto. Os nomes necessários foram auditados localmente, sem revelar valores. Antes de provisionar dispositivos, confirmar no ambiente Production da Vercel, no mínimo, `SUPABASE_URL`, chave publicável/anon, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `PUBLIC_APP_URL`, `KIOSK_ID`, `PRINT_AGENT_TOKEN` e o novo `PRINT_PROVISIONING_SECRET`. O valor de `PRINT_PROVISIONING_SECRET` não foi criado nem exibido por este relatório.

## Validações executadas

- `npm test`: 93 testes, 92 aprovados e 1 skip de integração PostgreSQL sem variáveis;
- `npm run test:print-v2`: 22 testes, 21 aprovados e 1 skip de integração PostgreSQL sem variáveis;
- `npm run test:print-v2:postgres`: 17 testes/16 subtestes aprovados em PostgreSQL isolado;
- `npm run check`, `npm run check:print-agent` e `npm run build`: aprovados;
- Android: `assembleDebug`, lint e testes unitários aprovados; teste físico permanece bloqueado;
- build Vercel: compilação Next.js e geração de 15 páginas aprovadas;
- logs Vercel: nenhum erro no intervalo inicial consultado.

## Correções visuais e PWA

As telas móveis passaram a usar a viewport dinâmica do dispositivo em uma grade fixa: cabeçalho e navegação permanecem na tela, enquanto somente o conteúdo da tela rola. A imagem de atendimento foi otimizada para o limite de upload do Vercel, e as telas de início, login, acompanhamento e TV passaram a usar o logo local menor, evitando o ícone quebrado quando o arquivo HD não está disponível. O `pwa.css` também foi incluído na página principal.

Quando o ambiente Production do Vercel não possui as três variáveis VAPID, o painel agora informa que os alertas estão indisponíveis sem exibir um erro vermelho nem bloquear o uso da fila. Para ativar notificações reais, ainda é necessário cadastrar `PUSH_NOTIFICATIONS_ENABLED`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no ambiente Production.

O cadastro de usuário também passou a tratar `localStorage` e `sessionStorage` como estado auxiliar. Em Safari/iPhone, navegação privada ou armazenamento cheio pode lançar `QuotaExceededError` ao gravar telemetria depois de uma resposta bem-sucedida; essa exceção não deve mais transformar um cadastro concluído no servidor em erro visual. A correção foi publicada no deployment `dpl_FTauNkNqxGk5xCCzcs8dT4knrDoX`.

## Pendências para liberar o primeiro destino v2

1. Definir um projeto Supabase/Vercel de staging ou registrar formalmente que a validação será diretamente em produção.
2. Configurar e validar os segredos Production da Vercel, especialmente `PRINT_PROVISIONING_SECRET` e a chave publicável.
3. Gerar inventário por loja: totem, impressora, porta/USB/serial, sistema operacional e responsável.
4. Registrar cada impressora/dispositivo, testar enrollment de uso único e ativar um destino por vez.
5. Validar Realtime privado, lease, reconexão, retry e estado `needs_review` com uma impressão real.
6. Executar a matriz Bematech no Windows (papel, corte, queda de rede, reinício e duplicidade).
7. Manter o Android como item bloqueado até existir tablet Android e POS-5890A-L físicos.
8. Monitorar `needs_review`, leases expirados, falhas de sinal, retries e o cron diário; decidir entre upgrade de plano e scheduler externo.

## Registro de ações

| Hora UTC aproximada | Ação | Resultado |
|---|---|---|
| 12:45 | auditoria Supabase/Vercel e inventário local | concluído |
| 12:45 | backup lógico criptografado de `print_jobs` | concluído |
| 12:50 | aplicação da migration `print_protocol_v2` | sucesso |
| 12:50 | reconciliação de esquema, RLS, funções e contagens | aprovado |
| 12:55 | primeiro deployment manual | erro esperado do plano Hobby (cron por minuto) |
| 12:57 | ajuste do cron para diário e novo deployment | `READY` |
| 12:58 | consulta de logs de erro pós-deploy | nenhum registro |
| 14:08 | publicação da correção visual com imagens binárias essenciais | `READY`; nenhum erro nos 15 minutos iniciais |

Nenhum segredo, token ou conteúdo do backup foi incluído neste relatório.
