# Agente Node SenhaHub: instalação no totem

Para instalar pelo totem, use `artifacts\SenhaHub.PrintAgent.Node-Setup.exe`. Abra o arquivo e aprove a solicitação de administrador do Windows; o próprio executável exige elevação. O instalador para o agente anterior, recupera as permissões da pasta e faz uma instalação limpa: apaga todos os arquivos antigos em `C:\ProgramData\SenhaHub\PrintAgent`, incluindo configuração, sessão pareada, journal SQLite e logs, e grava os arquivos novos. Cada execução exige um código de pareamento atual. Se o UAC for cancelado, feche e abra o `.exe` com o botão direito > **Executar como administrador**. O instalador gráfico inclui o executável Windows x64 e não precisa de PowerShell, código-fonte, Node.js, npm ou `node_modules` no totem.

O código temporário vence em 30 minutos. Use **Abrir console** para gerar um código novo e cole-o no campo mascarado. O valor não entra nos registros e é removido da configuração após o primeiro bootstrap autenticado. O instalador protege os arquivos para SYSTEM e administradores locais, registra a tarefa no Agendador de Tarefas e inicia o agente. Como cada execução limpa a pasta anterior, gere um código novo para reinstalar.

O destino padrão é `C:\ProgramData\SenhaHub\PrintAgent`, em disco local NTFS. O `.exe` inclui runtime Node 24, SQLite e o módulo serial nativo do Windows x64.

## Instalação pela interface gráfica

1. Copie `SenhaHub.PrintAgent.Node-Setup.exe` para o totem e abra-o. O Windows solicitará elevação de administrador.
2. Confirme a porta da Bematech. O instalador seleciona `COM3` por padrão e mantém essa opção mesmo se o Windows não a enumerar; nesse caso, confirme cabo e driver antes de testar impressão.
3. O código temporário desta distribuição já estará no campo mascarado. Clique em **Mostrar código** para conferir se desejar e depois em **Instalar e iniciar agente**; o código vale por 30 minutos.
4. Acompanhe o resultado no registro exibido pela janela. O instalador aguarda até 60 segundos pelo primeiro bootstrap autenticado.
5. Quando a instalação terminar, clique em **Testar impressão** para imprimir um cupom físico. Confirme que não há impressão em andamento; o teste pausa e depois retoma a tarefa do agente.

O instalador inclui o driver USB/serial Bematech x64 `bematech-usbcom.inf` 4.0.2.32103, correspondente ao VID/PID `USB\VID_0B1B&PID_0003` da MP-4200 TH. Na instalação, valida e prepara o pacote, identifica versões antigas pelo INF publicado em `Windows\INF` (classe Ports, serviço Bematech e VID/PID da MP-4200), preserva o pacote recém-validado, remove as versões anteriores e solicita uma nova varredura do Windows. O pacote cria a porta COM; o agente imprime diretamente por ela e não depende do driver de spooler. A caixa **Diagnóstico USB / driver** lista as portas, os pacotes do driver e o resultado da enumeração USB no Gerenciador de Dispositivos.

O QR de acompanhamento é codificado pelo agente como bitmap ESC/POS (`GS v 0`), com margem branca para leitura. Isso evita depender da função de QR nativa `GS ( k`, que no equipamento relatado estava saindo como texto.

O instalador usa os arquivos da pasta `installer\driver`, extraídos da distribuição Bematech V4.0.2 (subpasta `W10_x64`). Se o Windows não enumerar o dispositivo USB mesmo após o pacote estar no Driver Store, o diagnóstico mostrará a diferença: o driver instalado não substitui a enumeração física USB.

Se a tarefa for criada, mas o bootstrap depender de internet ou de um código expirado, a janela informa o caminho do log. Corrija a conexão, gere um código novo no console e execute novamente. A nova execução apaga os arquivos da tentativa anterior.

O instalador gráfico é um único `.exe` autossuficiente: agente, runtime, driver Bematech e código temporário ficam embutidos nele. Não é necessário baixar nem copiar arquivos auxiliares.

## Diagnóstico e operação

Os comandos abaixo rodam no totem sem o pacote extraído nem o código-fonte:

```powershell
& "$env:ProgramData\SenhaHub\PrintAgent\diagnose.ps1" -LocalOnly
& "$env:ProgramData\SenhaHub\PrintAgent\diagnose.ps1"
& "$env:ProgramData\SenhaHub\PrintAgent\SenhaHub.PrintAgent.Node.exe" --list-ports
& "$env:ProgramData\SenhaHub\PrintAgent\SenhaHub.PrintAgent.Node.exe" --test-printer
```

O diagnóstico verifica configuração, serial, sessão, SQLite, tarefa, processo, ACLs, eventos de suspensão e logs. Com sessão salva, consulta o bootstrap; só chama `recover` quando a tarefa está parada, para não interferir em uma impressão ativa.

Os registros e a configuração ficam em `C:\ProgramData\SenhaHub\PrintAgent\data\print-agent`. Nunca copie o arquivo `.env.print-agent` para o pacote de distribuição: ele contém o código de pareamento e a configuração específica do dispositivo.

## Gerar o pacote no computador de build

No computador de build Windows, com Node.js 22, Visual Studio/Build Tools e as dependências do repositório instaladas:

```powershell
npm ci
.\windows\print-agent-node\build.ps1
```

O script cria somente `windows\print-agent-node\artifacts\SenhaHub.PrintAgent.Node-Setup.exe`. Informe um código temporário válido no parâmetro `-PairingCode`; o build para antes de gerar o instalador se o código estiver ausente ou inválido. O instalador pré-preenche o campo, mantém o valor mascarado e não o grava nos logs.
