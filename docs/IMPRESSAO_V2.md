# Impressão v2: operação e rollout

Este documento é a referência operacional da fila de impressão do SenhaHub. A migration `20260905055534_print_protocol_v2.sql` é aditiva e mantém o protocolo v1 disponível até cada destino ser ativado. Nenhuma migration foi aplicada ao projeto de produção durante esta implementação.

## O que mudou

`print_jobs` é a verdade durável. Cada execução v2 possui `device_id`, `printer_id`, `lease_id`, `attempt_version`, validade da concessão e histórico em `print_job_attempts`. O agente grava a intenção e o resultado em um journal SQLite local antes de confirmar o trabalho. A emissão web usa uma chave idempotente por escopo (`kiosk_id`), e a resposta repetida é devolvida sem criar outra senha.

O dispositivo só recebe trabalhos do seu `kiosk`, loja e impressora registrados. A RPC de claim bloqueia fisicamente a impressora e há apenas um escritor em `leased`, `printing` ou `needs_review`. O claim é transacional e não grava atividade quando a fila está vazia. O lease é renovável por no máximo dez minutos; uma execução que expirou em `printing` fica em revisão e bloqueia a impressora. Uma execução que expirou antes do envio volta a `retry_wait` ou `failed` conforme o limite de cinco tentativas.

O Broadcast Realtime é privado e serve apenas como wake-up. O agente não confia no evento para decidir o que imprimir: depois do subscribe confirmado, de uma reconexão ou do watchdog de reconciliação, ele consulta a fila. O SSE local usa `LISTEN/NOTIFY` com a mesma regra. Não há heartbeat HTTP nem polling de dois segundos no agente. O heartbeat de 25 segundos existe apenas no WebSocket/Supabase Realtime.

Um resultado físico desconhecido nunca é reimpresso automaticamente. O trabalho fica `needs_review`, a impressora fica bloqueada e o painel administrativo exige confirmação explícita de que o escritor foi parado, um motivo e uma ação auditada (`confirm_printed`, `resolve_failed` ou `reprint`).

## Endpoints do agente

Todos os comandos v2 usam `POST /api/print/v2/...` e Bearer de um dispositivo; o corpo não pode escolher loja, setor, totem, dispositivo ou impressora.

| endpoint | uso |
| --- | --- |
| `/bootstrap` | valida o dispositivo, registra versão e devolve escopo, tópico privado e intervalo de reconciliação |
| `/claim` | reivindica no máximo um trabalho com `requestId` UUID persistido |
| `/recover` | recupera a execução ativa ou informa bloqueio |
| `/start` | transforma o lease em `printing` de forma idempotente |
| `/renew` | estende o lease dentro da janela permitida |
| `/finish` | confirma `printed`, `before_send` ou `unknown`; a operação é idempotente por lease |
| `/events` | stream SSE autenticado no backend local |
| `/provision`, `/enroll` | provisionamento cloud com código único de dez minutos; nunca distribuídos no agente |
| `/resolve` | resolução administrativa auditada de uma revisão |

## Provisionamento seguro

O provisionamento cloud roda em um backend confiável com `PRINT_PROVISIONING_SECRET` de 32 bytes hexadecimais. Um administrador chama `/api/print/v2/provision`; a resposta contém um código de uso único por dez minutos. O agente envia o código uma vez a `/enroll`, recebe a sessão Supabase e grava a sessão cifrada localmente. Se o código for perdido ou expirar, reprovisione o dispositivo; nenhum trabalho é impresso pelo código antigo. O administrador pode revogar o dispositivo sem apagar os jobs ou o journal.

Para um backend local, use `scripts/print-device-sqlite.js` ou `scripts/print-device-admin.js` em um host confiável. O arquivo de saída da credencial é criado com modo `0600`. O token local nunca deve entrar no Git, em logs ou em uma variável pública.

Exemplo de entrada, salvo em arquivo com permissões restritas:

```json
{"action":"provision-local","kioskId":"totem-pompeia-01","name":"Totem Pompeia","outputFile":"/secure/print-device.json","simulator":false}
```

Antes da ativação, registre a impressora por `hardware_key`, confirme loja e totem, pare o escritor v1 e resolva qualquer execução ativa. Depois execute a ação `activate` com `writerStopped: true`. A ativação migra apenas jobs pendentes v1 daquele destino. Não ative dois writers para o mesmo hardware.

## Variáveis essenciais

No backend cloud: `PRINT_PROVISIONING_SECRET`, `PRINT_REALTIME_ENABLED=1`, `PRINT_RECONCILIATION_MS` (mínimo 60000, padrão 600000) e as chaves Supabase já usadas pelo runtime. Em cada agente Windows, inclusive nos mini PCs que substituíram os tablets: `PRINT_API_URL` HTTPS, `PRINT_ENROLLMENT_CODE` somente no primeiro pareamento, `PRINT_AGENT_STATE_DIR`, `KIOSK_ID` quando aplicável ao agente legado, `KIOSK_PRINTER_PORT` e os parâmetros `PRINT_SERIAL_*`. O agente x86 homologado usa `KIOSK_PRINTER_PORT=COM4` no mini PC da Bematech. O agente Android permanece apenas como alternativa para hardware Android/Bluetooth separado.

`PRINT_REALTIME_ENABLED=0` é um modo de contingência: o agente continua recuperando por watchdog, com intervalo de reconciliação, sem abrir o canal privado. Não desative o Realtime como configuração permanente sem aceitar a latência do intervalo.

## Operação diária

No Windows, use `npm run print:agent:ports` para descobrir a porta e `npm run print:agent:test` para um cupom de diagnóstico. O serviço mantém a configuração e o journal em `data/print-agent`; o instalador aplica ACL ao diretório padrão. Se `PRINT_AGENT_STATE_DIR` apontar para outro diretório, aplique ACL equivalente manualmente.

Nos mini PCs Windows, o agente x86 precisa permanecer instalado como serviço e ter acesso exclusivo à porta serial virtual da Bematech. A primeira validação de campo deve cobrir pareamento do dispositivo, reboot, queda de rede, queda de energia, papel, corte e recuperação de lease. A ausência de um Android físico não impede o build, os testes unitários ou a revisão do protocolo.

A impressora só confirma que recebeu os bytes. Sem sensor transacional, não é possível provar que o papel saiu; queda exatamente entre o envio e o journal pode exigir resolução manual. Em qualquer dúvida, deixe `needs_review` e use o painel administrativo. Nunca apague a linha ou recrie manualmente o mesmo ticket para “destravar”.

## Agendamento e manutenção

`vercel.json` agenda `/api/internal/jobs` diariamente às 03:00 UTC, compatível com o plano Hobby detectado no projeto. Para sweep a cada minuto, faça upgrade para um plano com Cron frequente ou execute a mesma rotina em um scheduler confiável com autenticação interna. Os agentes também fazem reconciliação periódica, e a rotina usa lease de manutenção no banco e chama `sweep_print_leases_v2`, tornando visível uma execução abandonada mesmo quando o dispositivo nunca reconecta. Falhas do sweep devem gerar alerta operacional; não devem ser ocultadas por uma resposta 200.

Monitore `print_signal_failures`, jobs em `needs_review`, leases expirados, idade de `retry_wait`, falhas do cron e logs Realtime. O Realtime pode registrar falha de entrega fora da transação do job; o estado durável continua correto e o watchdog reconcilia a fila.

## Rollout e rollback

1. Faça backup do banco e aplique a migration em staging. Como os IDs históricos de migration do projeto remoto não coincidem necessariamente com a pasta local, revise e aplique esta migration individualmente; não use `supabase db push` sem reconciliar o histórico.
2. Registre impressora, dispositivo e escopo. Rode os testes de emissão idempotente, dois agentes no mesmo hardware e recuperação de lease.
3. Pare o writer v1, resolva execuções ativas e ative um único totem por vez. Observe jobs, `print_signal_failures` e o painel por um período operacional.
4. Ative o próximo destino somente depois de confirmar o anterior. Mantenha v1 para destinos ainda não migrados.

Para voltar ao writer anterior, pare o agente v2, resolva ou preserve as execuções conforme o painel e reative o destino com a rotina operacional equivalente. Não remova colunas, índices, histórico, dispositivos ou jobs: a migration foi desenhada para rollback por roteamento, não por apagar dados.

## Verificação executada nesta entrega

Use `npm run check`, `npm run check:print-agent`, `npm run test:print-v2`, `npm run test:print-v2:postgres` (PostgreSQL isolado) e `npm run build`. O módulo Android foi compilado com `assembleDebug`, `lintDebug` e `testDebugUnitTest` em JDK 17/Gradle 8.9. Esses checks não substituem teste físico Android, Bluetooth, serial, papel ou produção Supabase/Realtime; nenhum deles foi executado nesta máquina Apple.

Arquivos centrais: `server/kiosk/print-v2-api.js`, `server/kiosk/print-v2-local.js`, `server/kiosk/print-v2-sqlite.js`, `scripts/print-agent/consumer.js`, `scripts/print-agent/durable-store.js`, `scripts/print-agent/realtime.js`, `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/PrinterAgentService.kt` e a migration citada acima.
