# Totem e fila de impressao

> A operação atual está em [docs/IMPRESSAO_V2.md](IMPRESSAO_V2.md). Este arquivo preserva o contexto histórico do totem e dos parâmetros físicos; os tokens v1, polling e endpoints antigos abaixo não são instruções para um novo pareamento.

O totem e os antigos tablets, agora mini PCs Windows, emitem senhas fisicas por filas próprias. A emissao cria, em uma unica transacao no Supabase, a senha e um trabalho de impressao. O agente x86 dos tablets envia ESC/POS para a Bematech MP-4200 TH; o agente do totem para a MP-4000 TH FI usa o protocolo fiscal de comandos e imprime o ticket como relatório gerencial não fiscal.

Para a MP-4000 TH FI, consulte o agente específico em [windows/print-agent-totem](../windows/print-agent-totem). Ele mantém as mesmas regras da fila v2, mas usa `9600`, 8 bits, sem paridade, 1 stop bit e RTS/CTS. O QR Code da MP-4200 não é enviado à MP-4000; a URL de acompanhamento sai como texto.

O instalador do Totem inclui o driver USB/COM Bematech 4.0.2 para Windows x64 e x86, registra automaticamente a variante adequada pelo `pnputil` e consulta a fila de impressão a cada 2 segundos. Em RS-232 físico, o adaptador serial ainda precisa criar a porta COM.

## Componentes entregues

- `/totem`: interface para escolher o setor e emitir a senha.
- `/instalar`: destino publico do QR Code exibido na tela do totem, com orientacoes para instalar o PWA.
- `print_kiosks`: cadastro e configuracao do totem.
- `print_jobs`: fila persistente, idempotente e com controle de tentativas.
- `npm run print:simulate`: consumidor local que simula o recibo de 80 mm.
- `npm run print:agent`: agente real que imprime pela porta `COM3`.
- Supabase Realtime: sinaliza novos trabalhos sem polling contínuo quando a fila está vazia.

## Variaveis da Vercel

Cadastre em Production e Preview:

```env
PUBLIC_APP_URL=https://senhahub.vercel.app
PUBLIC_INSTALL_URL=https://senhahub.vercel.app/instalar
KIOSK_ID=totem-pompeia-01
KIOSK_NAME=Totem Supermercado Pompeia
KIOSK_PRINTER_NAME=Bematech MP - 4200 TH
KIOSK_PRINTER_PORT=COM3
KIOSK_PAPER_WIDTH_MM=80
PRINT_AGENT_TOKEN=<segredo-aleatorio-com-32-ou-mais-caracteres>
```

Gere o token sem coloca-lo no Git:

```bash
openssl rand -base64 48
```

## Preparacao do banco

Depois do schema inicial e da migration de PWA, aplique:

```text
supabase/migrations/20260729154028_print_kiosk_jobs.sql
supabase/migrations/20260729175827_index_tickets_kiosk_id.sql
supabase/migrations/20260823130843_print_job_realtime_signal.sql
```

Essas migrations ja foram aplicadas ao projeto Supabase atualmente conectado. A última cria um sinal Realtime mínimo por totem; a reivindicação continua protegida pelo token do agente e pela RPC `claim_next_print_job`.

## Pareamento do totem

1. Abra `/totem` no computador do supermercado.
2. Entre com uma conta de gestor quando a pagina solicitar.
3. Confirme o pareamento do equipamento `totem-pompeia-01`.
4. O navegador recebe uma credencial assinada e restrita ao totem.

O pareamento deve ser feito novamente se os cookies do navegador forem apagados ou o equipamento for desvinculado.

## Teste com o simulador

No computador que consumira a fila, configure:

```env
PRINT_API_URL=https://senhahub.vercel.app
PRINT_AGENT_TOKEN=<o-mesmo-segredo-configurado-na-vercel>
KIOSK_ID=totem-pompeia-01
PRINT_REALTIME_ENABLED=1
PRINT_POLL_INTERVAL_MS=2000
PRINT_FALLBACK_POLL_INTERVAL_MS=30000
PRINT_HEARTBEAT_INTERVAL_MS=60000
```

Execute:

```bash
npm run print:simulate
```

O simulador busca um trabalho pendente, mostra o conteudo do recibo no terminal e confirma a conclusao na API. Ele nao envia dados para a porta `COM3`; use o agente Windows abaixo para a impressao real.

## Agente Windows e Bematech

Requisitos no computador do totem:

- Windows 10 de 64 bits;
- Node.js 22 LTS;
- Bematech MP-4200 TH instalada e visivel como `COM3`;
- impressora configurada no modo de comandos ESC/POS;
- acesso HTTPS a `https://senhahub.vercel.app`.

No computador Windows, clone ou copie o projeto para uma pasta fixa. Depois copie `.env.print-agent.example` para `.env.print-agent` e preencha `PRINT_AGENT_TOKEN` com o mesmo segredo cadastrado na Vercel. O agente obtém automaticamente a configuração pública do Realtime por uma rota protegida pelo token. Nunca configure a `SUPABASE_SERVICE_ROLE_KEY` no computador do totem.

Confirme a porta detectada:

```powershell
npm run print:agent:ports
```

Envie um cupom de diagnostico diretamente para a impressora:

```powershell
npm run print:agent:test
```

Se o cupom nao for impresso, confira no autoteste da Bematech a porta, o modo ESC/POS e os parametros seriais. O projeto usa inicialmente `115200`, 8 bits, sem paridade e 1 stop bit; ajuste `PRINT_SERIAL_*` no arquivo local para coincidir com a configuracao da impressora.

Quando o teste estiver correto, abra o PowerShell como Administrador e instale a inicializacao automatica:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\print-agent\install.ps1
```

O instalador:

1. instala as dependencias travadas no `package-lock.json`;
2. restringe a leitura do arquivo de configuracao;
3. registra o agente no Agendador de Tarefas como `SYSTEM`;
4. inicia o processo e reinicia automaticamente em caso de falha.

Os logs e o registro local contra reimpressoes ficam em:

```text
data\print-agent\print-agent.log
data\print-agent\printed-jobs.log
```

Para remover a inicializacao automatica:

```powershell
.\windows\print-agent\uninstall.ps1
```

`PRINT_STATUS_CHECK_ENABLED=0` e o modo inicial mais compativel. Depois de validar que a impressora responde ao comando ESC/POS `DLE EOT`, altere para `1` para detectar tampa aberta, falta de papel e falhas antes de confirmar a impressao.

O papel impresso segue esta ordem: `SUPERMERCADO POMPEIA`, `SenhaHub`, setor, `SENHA`, numero da senha, data e horario de emissao e o QR Code individual para acompanhar a senha. O QR Code impresso aponta para `/acompanhar/<token>` e nao para a tela de instalacao.

O agente registra localmente cada trabalho enviado antes de confirma-lo na API. Se a internet cair apos a impressao, uma nova tentativa confirma o mesmo trabalho sem imprimir novamente. Uma queda de energia exatamente entre o corte do papel e esse registro ainda pode gerar uma segunda via, limitacao inerente a impressoras sem confirmacao transacional.

## Bematech do mini PC do tablet — Açougue da Loja 2

A Bematech do mini PC usa uma fila própria, `tablet-pompeia-01`, restrita ao setor `acougue-loja-2`. Ela deve ser configurada em um agente Windows x86 próprio; não compartilhe o mesmo agente ou a mesma porta serial com outro equipamento.

O `/tablet` apenas cria o trabalho e acompanha o status. O agente x86 pareado ao destino `tablet-pompeia-01` reivindica a senha, envia os bytes ESC/POS para a Bematech local e confirma o resultado. Os demais mini PCs devem usar seus próprios destinos e agentes, cada um com uma impressora física diferente.

Variáveis adicionais do backend:

```env
TABLET_PRINTER_KIOSK_ID=tablet-pompeia-01
TABLET_PRINTER_MODE=sector
TABLET_PRINTER_SECTOR_ID=acougue-loja-2
TABLET_PRINTER_STORE_CODE=loja-2
TABLET_PRINTER_NAME=Bematech MP - 4200 TH
TABLET_PRINTER_PORT=COM4
TABLET_PAPER_WIDTH_MM=80
```

No mini PC, instale exclusivamente o agente x86 `1.2.5` em `windows/print-agent-x86`, confirme a porta real da Bematech (`COM4` no equipamento homologado), faça primeiro o teste físico e só então abra `/tablet` para emitir uma senha. O agente confirma a impressão na fila; em caso de resultado físico incerto, a reimpressão exige resolução administrativa.
