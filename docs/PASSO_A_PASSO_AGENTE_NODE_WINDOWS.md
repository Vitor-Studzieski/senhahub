# Instalação e diagnóstico do agente Node no Windows

Este guia cobre o agente Node.js do protocolo v2 com a Bematech MP-4200 TH. O protocolo atual usa dispositivo pareado, sessão local, lease, journal SQLite e confirmação transacional. As instruções antigas de `PRINT_AGENT_TOKEN`, polling v1 e `printed-jobs.log` não se aplicam ao agente atual.

## Instalação do agente `.exe` no totem

Para instalar sem colocar código-fonte, Node.js ou npm no mini PC, copie apenas `SenhaHub.PrintAgent.Node-Setup.zip` para o totem e siga o [guia do executável Windows](../windows/print-agent-node/README.md). O pacote inclui o executável, o modelo de configuração, o diagnóstico e o instalador da tarefa agendada. O instalador gráfico exige um código temporário atual do console em toda execução e apaga os arquivos anteriores do agente, incluindo sessão e journal SQLite. Use-o somente quando essa instalação limpa for desejada.

As instruções abaixo descrevem a instalação pela árvore Node.js, útil para manutenção e desenvolvimento.

## Primeira instalação do totem

O primeiro pareamento exige um código novo, de uso único e válido por dez minutos. O instalador faz a preparação antes de pedir o código para que o tempo não seja consumido enquanto o Node e as dependências são instalados.

1. Cadastre e ative no console administrativo o dispositivo para o totem e a impressora corretos.
2. Conecte a Bematech ao mini PC e confirme o papel, a alimentação e o cabo.
3. Instale Node.js 22.13 ou superior na série 22.x e copie o projeto para uma pasta fixa, por exemplo `C:\SenhaHub`.
4. Copie `.env.print-agent.example` para `.env.print-agent`, configure o servidor e a COM real. Deixe `PRINT_ENROLLMENT_CODE` vazio.
5. Rode o teste físico abaixo e confirme que o cupom saiu.
6. Abra PowerShell como administrador e execute `windows\print-agent\install.ps1`.
7. Quando o instalador pedir, gere no console administrativo um código temporário para esse dispositivo e cole-o no PowerShell. O código não aparece no log.
8. O instalador grava o código com ACL restrita, registra e inicia a tarefa do Windows e aguarda até 45 segundos pelo primeiro bootstrap autenticado.

Gere o código do console somente quando o instalador pedir. Se ele expirar, for usado ou o pareamento não concluir, gere outro no console, substitua `PRINT_ENROLLMENT_CODE` em `.env.print-agent` e reinicie a tarefa. Este procedimento via scripts do repositório mantém a sessão e o journal em reinstalações; o instalador gráfico `.exe` faz uma instalação limpa e os apaga.

## Pré-requisitos

- Windows 10 ou superior, preferencialmente 64 bits;
- Node.js 22.13 ou superior dentro da série 22.x e npm;
- PowerShell como administrador para registrar a tarefa;
- projeto em uma pasta fixa e com `package-lock.json`;
- internet HTTPS até o SenhaHub;
- Bematech MP-4200 TH conectada como porta serial COM e driver/conversor instalado.

Confirme o Node e o npm:

```powershell
node --version
npm --version
```

O Node deve mostrar `v22.13.0` ou superior dentro da série 22.x. O agente usa `node:sqlite` para o journal local. Se o comando `node` não for encontrado, reabra o PowerShell depois de instalar Node.js.

## Configuração

Copie o modelo e ajuste o arquivo:

```powershell
Set-Location C:\SenhaHub
Copy-Item .env.print-agent.example .env.print-agent
notepad .env.print-agent
```

Configuração principal para primeira instalação:

```env
PRINT_API_URL=https://senhahub.vercel.app
PRINT_ENROLLMENT_CODE=
PRINT_REALTIME_ENABLED=1
PRINT_RECONCILIATION_MS=600000

KIOSK_PRINTER_PORT=COM4
PRINT_SERIAL_BAUD_RATE=115200
PRINT_SERIAL_DATA_BITS=8
PRINT_SERIAL_STOP_BITS=1
PRINT_SERIAL_PARITY=none
PRINT_SERIAL_RTSCTS=0

PRINT_STATUS_CHECK_ENABLED=0
PRINT_STATUS_TIMEOUT_MS=1500
PRINT_AGENT_STATE_DIR=./data/print-agent
```

Use a porta mostrada no Gerenciador de Dispositivos. Durante a configuração inicial, mantenha `PRINT_STATUS_CHECK_ENABLED=0`; algumas unidades não respondem ao comando ESC/POS de consulta de estado. Não configure `PRINT_AGENT_TOKEN` para o fluxo v2. O agente recebe uma sessão restrita pelo pareamento. Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` ou senha de banco neste computador.

## Descobrir e testar a impressora

Na pasta do projeto, liste as COM:

```powershell
npm ci --omit=dev
npm run print:agent:ports
```

Se a Bematech aparecer, ajuste `KIOSK_PRINTER_PORT` no `.env.print-agent`. Para confirmar a impressão física:

```powershell
npm run print:agent:test
```

Esse comando envia um cupom identificado como **Teste** e não consulta a fila. Faça o teste quando puder recolher o papel. Se não imprimir, confira energia, papel, cabo, porta, driver, modo ESC/POS, baud rate e se outro programa já abriu a COM.

## Instalar execução automática

Depois de confirmar o teste físico, em PowerShell como administrador:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\print-agent\install.ps1
```

O instalador registra a saída de `npm ci`, valida Node 22.13+ e dependências, executa o diagnóstico local e confirma que a COM configurada aparece. Na primeira instalação, ele solicita o código atual do console depois dessa preparação. A tarefa é executada como `SYSTEM`, inicia com o Windows e tem até 20 reinícios automáticos, separados por um minuto.

A tarefa criada se chama:

```text
SenhaHub - Agente de Impressao
```

Comandos para conferir e controlar a tarefa:

```powershell
Get-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
Get-ScheduledTaskInfo -TaskName "SenhaHub - Agente de Impressao"
Stop-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
Start-ScheduledTask -TaskName "SenhaHub - Agente de Impressao"
```

O instalador aguarda até 45 segundos pelo bootstrap. Se o pareamento falhar, a tarefa continua tentando com espera progressiva e o log registra HTTP/status/motivo sem gravar credenciais. Depois de trocar por um código novo, reinicie a tarefa.

## Diagnóstico

Rode na pasta do projeto, como administrador para ler a pasta de estado protegida:

```powershell
npm run print:agent:diagnose
```

O relatório verifica:

- Node, arquivos do projeto, dependências e `serialport`;
- configuração sem revelar tokens ou código de pareamento;
- portas COM e presença da porta configurada;
- tarefa agendada, ação, estado, último resultado e reinícios;
- processos Node do agente, tempo ligado e eventos de suspensão/retomada;
- log da instalação, falhas de inicialização, erros do agente e estado do journal SQLite;
- bootstrap autenticado, se já existir uma sessão salva.

O diagnóstico não imprime nem reivindica trabalhos e não consome o código de pareamento. Com sessão salva, ele chama `bootstrap` para confirmar autenticação e escopo. Se a tarefa estiver parada ou ausente, também chama `recover` para mostrar o estado remoto e aplicar a recuperação normal de leases vencidos; isso pode mudar um lease antigo para `retry_wait` ou `needs_review`. Se a tarefa estiver rodando, pula essa consulta para não interferir em uma impressão ativa. O comando retorna código de saída `1` se encontrar uma falha.

Para ver o relatório como JSON ou validar localmente antes de instalar:

```powershell
npm run print:agent:diagnose -- --json
node scripts\print-agent\diagnostic.js --local-only --preinstall
```

## Logs e estado local

Por padrão, os arquivos ficam em `data\print-agent`:

```text
install.log             saída do instalador e erros de pré-instalação
print-agent.log         operação, autenticação, Realtime e falhas de impressão
print-agent.log.1       log anterior após rotação
agent-startup.log       exceções fatais durante a inicialização
agent-v2.sqlite         sessão do dispositivo e journal de trabalhos
```

Veja o log ao vivo e as últimas linhas:

```powershell
Get-Content .\data\print-agent\print-agent.log -Wait
Get-Content .\data\print-agent\print-agent.log -Tail 60
Get-Content .\data\print-agent\install.log -Tail 60
```

Se `PRINT_AGENT_STATE_DIR` apontar para outro lugar, use essa pasta nos comandos. O instalador restringe a leitura do arquivo de configuração e do journal ao `SYSTEM` e aos administradores locais. Não apague `agent-v2.sqlite` manualmente: ele guarda sessão e estado de trabalhos que podem precisar de revisão para evitar uma segunda impressão. O instalador gráfico `.exe` apaga esse arquivo como parte da instalação limpa.

## Interpretar falhas comuns

| Sinal no relatório/log | O que verificar |
|---|---|
| `Node.js 22.13 ou superior` | Atualize para Node 22 LTS e confirme o caminho mostrado pelo diagnóstico. |
| `serialport` ausente ou módulo nativo não carregou | Rode `npm ci --omit=dev` com Node 22 e consulte `install.log`. |
| Porta configurada ausente | Confira cabo, driver e `KIOSK_PRINTER_PORT` em `npm run print:agent:ports`. |
| Porta em uso ou sem permissão | Feche monitor serial e outras instâncias; confira usuário/tarefa e ACL. |
| `invalid_enrollment` / HTTP 401 na primeira instalação | Gere um código novo no console; o anterior pode ter expirado ou já ter sido usado. |
| HTTP 401 depois de pareado | A sessão local expirou ou foi recusada; confira o log e rode o diagnóstico autenticado. |
| HTTP 403 / `device_revoked` / `device_scope_invalid` | Confirme que o dispositivo está ativo e vinculado ao totem, loja e impressora corretos no console. |
| Erro de DNS, TLS ou `fetch failed` | Confira internet, DNS, data/hora do Windows e acesso HTTPS ao servidor. |
| `needs_review` ou resultado físico incerto | Confira se o papel saiu e resolva o trabalho no painel antes de nova impressão. Não limpe o journal. |
| Tarefa ativa, mas sem impressão | Confirme Realtime, emissão do trabalho, estado do dispositivo e eventos recentes do journal/log. |

Um resultado físico incerto bloqueia a impressora para impedir duplicidade. Se a senha saiu, confirme no painel; se não saiu, resolva o trabalho para reimpressão após verificar fisicamente.

## Operação manual e simulador

Para iniciar em primeiro plano:

```powershell
npm run print:agent
```

Use `Ctrl+C` para parar. O agente usa Realtime como sinal de nova fila e reconciliação periódica para recuperar eventos perdidos. Com `PRINT_REALTIME_ENABLED=0`, a reconciliação segue ativa, mas pode aumentar o tempo até buscar uma nova senha.

O protocolo v2 e o painel de impressão estão descritos em [docs/IMPRESSAO_V2.md](IMPRESSAO_V2.md). A fila usa leases e journal. Um envio interrompido depois que os bytes começaram pode ficar em `needs_review`; ele não deve ser reivindicado para reimpressão automática.

## Segurança

- Não envie `.env.print-agent` nem `agent-v2.sqlite` para o Git ou para atendimento.
- Não compartilhe logs sem revisar dados operacionais do dispositivo.
- Não apague manualmente journal ou estado para “destravar” impressão; a instalação gráfica `.exe` limpa esses arquivos deliberadamente e deve ser usada só quando se deseja reiniciar o pareamento e o journal.
- Gere um código de pareamento próprio para cada dispositivo; ele é de uso único e expira em dez minutos.
- Use credenciais administrativas somente no console/backend de provisionamento, nunca no totem.
