# Arquivos do protocolo de impressão v2

Este inventário cobre os arquivos alterados ou adicionados para a entrega do protocolo v2. Arquivos de build, caches, backups e alterações anteriores já existentes no working tree ficam fora dele.

## Banco e runtime

- `supabase/migrations/20260905055534_print_protocol_v2.sql`
- `server/integrations/supabase-runtime.js`
- `server/server.js`
- `server/data/local-postgres.js`
- `server/kiosk/print-kiosk-service.js`
- `server/kiosk/local-kiosk.js`
- `server/kiosk/print-v2-api.js`
- `server/kiosk/print-v2-local.js`
- `server/kiosk/print-v2-sqlite.js`
- `app/api/[...path]/route.js`
- `app/api/local-postgres/print/v2/[...command]/route.js`
- `app/api/local-postgres/print/heartbeat/route.js` (compatibilidade v1 local)
- `app/api/local-postgres/print/realtime-config/route.js` (compatibilidade v1 local)
- `app/api/local-postgres/tablet/print-job/route.js` (consulta de status da tela)
- `vercel.json`

## Agentes e administração

- `scripts/print-agent.js`
- `scripts/print-simulator.js`
- `scripts/print-agent/runtime.js`
- `scripts/print-agent/session.js`
- `scripts/print-agent/realtime.js`
- `scripts/print-agent/consumer.js`
- `scripts/print-agent/durable-store.js`
- `scripts/print-agent/serial-printer.js`
- `scripts/print-device-admin.js`
- `scripts/print-device-sqlite.js`
- `scripts/test-print-v2-postgres.js`
- `windows/print-agent/install.ps1`

## Android

- `android/print-agent/.gitignore`
- `android/print-agent/README.md`
- `android/print-agent/settings.gradle.kts`
- `android/print-agent/build.gradle.kts`
- `android/print-agent/gradle.properties`
- `android/print-agent/app/build.gradle.kts`
- `android/print-agent/app/src/main/AndroidManifest.xml`
- `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/AgentNetwork.kt`
- `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/AgentStorage.kt`
- `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/BootReceiver.kt`
- `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/MainActivity.kt`
- `android/print-agent/app/src/main/java/com/senhahub/bluetoothprintagent/PrinterAgentService.kt`
- `android/print-agent/app/src/test/java/com/senhahub/bluetoothprintagent/AgentJournalTest.kt`

## Interface, configuração e testes

- `.env.example`
- `.env.print-agent.example`
- `README.md`
- `docs/IMPRESSAO_V2.md`
- `docs/PASSO_A_PASSO_AGENTE_NODE_WINDOWS.md`
- `docs/ESTUDO_FEATURE_IMPRESSORA.md`
- `docs/totem-impressao.md`
- `public/admin-totens.html`
- `public/admin.js`
- `public/totem.js`
- `public/tablet.js`
- `tests/print-agent.test.js`
- `tests/print-v2-api.test.js`
- `tests/print-v2-consumer.test.js`
- `tests/print-v2-postgres.test.js`
- `tests/print-v2-sqlite.test.js`
