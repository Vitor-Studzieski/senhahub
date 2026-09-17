# Agente x86 do SenhaHub

Este agente é uma alternativa para o mini PC com Windows de 32 bits e processador baseado em x64. Ele não usa Node.js nem o pacote `serialport`: é um executável C# para .NET Framework 4.8, compilado com `PlatformTarget=x86`, e envia ESC/POS diretamente para a porta serial virtual da Bematech.

A versão `x86/1.1.0` usa a API nativa de comunicação do Windows para abrir a porta. Isso contorna um problema de alguns drivers USB/serial que retornam `O tempo limite do semáforo expirou` quando a porta é aberta pelo `System.IO.Ports.SerialPort`.

## Versão homologada

A versão `x86/1.0.0` desta pasta foi homologada no mini PC com Windows 10 de 32 bits e na Bematech MP-4200 TH identificada como `COM4`. Ela instala o serviço `SenhaHubPrintAgentX86`, inicia automaticamente com o Windows e foi validada imprimindo uma senha real pelo SenhaHub.

Use esta versão como base para os próximos tablets. Para cada tablet novo, gere um código de pareamento próprio no SenhaHub; o código usado no teste é temporário, de uso único e expira em dez minutos.

## Compilar

Abra o projeto em um Windows com Visual Studio ou Build Tools instalados e compile a configuração `Release | x86`:

```text
windows\print-agent-x86\SenhaHub.PrintAgent.X86.csproj
```

Copie `bin\Release\SenhaHub.PrintAgent.X86.exe` para uma pasta fixa no mini PC, por exemplo `C:\SenhaHubPrintAgentX86`. Copie também `agent.env.example` como `agent.env`.

## Gerar o instalador `.exe`

Em um Windows com Visual Studio ou Build Tools instalados, abra o PowerShell nesta pasta e execute:

```powershell
.\build-installer.ps1
```

O script compila o agente e gera um único instalador em `installer\bin\Release\SenhaHub.PrintAgent.Setup.exe`. O instalador pede o servidor, o código de pareamento e a porta, testa a Bematech, grava a configuração, instala o agente como serviço `SenhaHubPrintAgentX86` e inicia o serviço automaticamente.

O instalador gerado pelo workflow embute os drivers oficiais USB/COM e Spooler x86 da MP-4200 TH. O botão `Instalar driver + agente` usa o Spooler do Windows, localiza a fila Bematech, envia um teste e pede confirmação do papel; o serviço só é instalado depois da confirmação física.

O repositório também possui o workflow `.github/workflows/print-agent-x86.yml`. Depois de enviar as alterações ao GitHub, execute `SenhaHub Print Agent x86` em **Actions** e baixe o artefato `senhahub-print-agent-x86-installer`. Assim, não é necessário instalar Visual Studio ou Build Tools no computador usado para operar o mini PC.

## Parear com o SenhaHub

1. Cadastre a MP-4200 TH e o destino do novo mini PC no SenhaHub.
2. Gere, no painel administrativo, um código de enrollment para esse dispositivo. O código é de uso único e expira em dez minutos.
3. Preencha `PRINT_ENROLLMENT_CODE` no `agent.env` e mantenha `PRINT_API_URL=https://senhahub.vercel.app`.
4. Configure `KIOSK_PRINTER_MODE=native-serial` e informe a porta exibida pelo Gerenciador de Dispositivos em `KIOSK_PRINTER_PORT`.
5. Execute uma vez no PowerShell para testar a impressora:

```powershell
.\SenhaHub.PrintAgent.X86.exe --list-ports
.\SenhaHub.PrintAgent.X86.exe --test-printer
```

6. Depois do teste físico, abra o PowerShell como Administrador e instale o serviço:

```powershell
    .\install.ps1
```

O primeiro início usa o código de enrollment, recebe uma sessão restrita do dispositivo e armazena essa sessão cifrada com DPAPI no computador. O código não é usado novamente. O agente envia a senha pela COM4, confirma o resultado na fila v2 e mantém um journal local para recuperação após queda de energia ou internet.

## Arquivos locais

```text
agent.env
data\print-agent-x86\agent-state.bin
data\print-agent-x86\print-agent-x86.log
```

O instalador restringe esses arquivos ao `SYSTEM` e aos administradores locais. Nunca envie `agent.env` ou `agent-state.bin` para o Git.

## Teste do fluxo completo

Depois que o agente estiver iniciado, solicite uma senha na URL do SenhaHub. O agente consulta a fila a cada cinco segundos. Confira o cupom físico e o log; o trabalho deve terminar como `printed`. Se o envio físico for interrompido depois que os bytes começaram a sair, o agente marca o trabalho como `needs_review` para impedir uma segunda via automática.

## Limitação conhecida

O agente x86 usa consulta periódica em vez do canal Realtime do agente Node. Isso reduz dependências no Windows 32 bits, com uma latência esperada de até cinco segundos para buscar uma nova senha. O protocolo v2, o pareamento, o lease, o journal e a regra de não reimpressão continuam os mesmos.
