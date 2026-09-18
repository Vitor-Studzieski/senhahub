# Agente do Totem — Bematech MP-4000 TH FI

Este agente é o executável Windows x86 do Totem SenhaHub para a impressora fiscal Bematech MP-4000 TH FI. Ele preserva as regras do agente x86: pareamento por código de uso único, consumo da fila v2, lease, confirmação transacional, journal local, recuperação após reinício e bloqueio de reimpressão quando o resultado físico fica incerto.

## Diferença importante de impressão

A MP-4000 TH FI não recebe o cupom ESC/POS usado pela MP-4200 TH. O perfil deste agente usa o protocolo de comandos da MP-4000 TH FI, com pacotes `STX/NBL/NBH/CMD/CSL/CSH`, aguarda `ACK/ST1/ST2` para cada comando e imprime o ticket como relatório gerencial não fiscal.

Como a MP-4000 TH FI não oferece no protocolo documentado o mesmo comando ESC/POS de QR Code usado pela MP-4200 TH, o endereço de acompanhamento é impresso como texto. O fluxo digital e a URL continuam iguais; somente a representação física muda.

## Gerar o executável e o instalador

A compilação precisa ser feita em Windows com Visual Studio ou Build Tools instalados e .NET Framework 4.8:

```powershell
.\build-installer.ps1
```

Os arquivos gerados serão:

```text
bin\Release\SenhaHub.PrintAgent.Totem.exe
installer\bin\Release\SenhaHub.PrintAgent.Totem.Setup.exe
artifacts\SenhaHub.PrintAgent.Totem-mp4000-v1.0.0.exe
artifacts\SenhaHub.PrintAgent.Totem.Setup-mp4000-v1.0.0.exe
```

Também é possível gerar o instalador sem Visual Studio local executando manualmente o workflow **SenhaHub Print Agent Totem MP-4000 TH FI** em GitHub Actions; o artefato terá o nome `senhahub-print-agent-totem-mp4000-v1.0.0-installer`.

O instalador não instala driver fiscal de terceiros. A MP-4000 TH FI precisa aparecer previamente no Gerenciador de Dispositivos como uma porta COM, normalmente por RS-232 ou por um conversor USB/serial compatível.

## Instalação

1. No painel administrativo, cadastre o destino físico do totem e gere o código de pareamento.
2. Conecte a MP-4000 TH FI e confira a porta COM.
3. Execute `SenhaHub.PrintAgent.Totem.Setup-mp4000-v1.0.0.exe` como administrador.
4. Informe o servidor, o código temporário e a porta.
5. Clique em **Testar impressora** e confirme que saiu o relatório de teste.
6. Somente depois confirme a instalação do serviço.

O serviço instalado é `SenhaHubPrintAgentTotem`. Os arquivos ficam em:

```text
C:\ProgramData\SenhaHub\PrintAgentTotem\agent.env
C:\ProgramData\SenhaHub\PrintAgentTotem\data\print-agent-totem\agent-state.bin
C:\ProgramData\SenhaHub\PrintAgentTotem\data\print-agent-totem\print-agent-totem.log
```

O `agent-state.bin` guarda a sessão do dispositivo e o trabalho em andamento protegido pelo DPAPI do Windows. Não copie esse arquivo para outro computador.

## Teste manual

Na pasta do agente, o teste pode ser executado assim:

```powershell
.\SenhaHub.PrintAgent.Totem.exe --list-ports
.\SenhaHub.PrintAgent.Totem.exe --test-printer
```

O padrão da MP-4000 TH FI é `9600`, 8 bits, sem paridade, 1 stop bit e RTS/CTS. Se a porta da unidade tiver sido reprogramada, ajuste `PRINT_SERIAL_*` no `agent.env` antes do teste.

## Limitações conhecidas

- A versão entregue imprime o QR como URL textual porque o protocolo fiscal da MP-4000 TH FI não documenta o comando QR ESC/POS da MP-4200 TH.
- O executável foi compilado para x86, compatível com Windows 32 bits e 64 bits com .NET Framework 4.8.
- Antes da primeira operação real, o relatório de teste físico é obrigatório; não confirme o teste apenas porque a porta COM abriu.
