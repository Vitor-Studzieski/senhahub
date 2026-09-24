# Agente Node SenhaHub: instalação no totem

Para instalar pelo totem, use `artifacts\SenhaHub.PrintAgent.Node-Setup.exe`. Abra o arquivo e aprove a solicitação de administrador do Windows; o próprio executável exige elevação. Se a pasta de uma tentativa anterior estiver com permissões incorretas, o instalador recupera o acesso somente para SYSTEM e administradores, para a tarefa/agente anterior e atualiza os arquivos sem apagar a configuração ou o journal. Se o UAC for cancelado, feche e abra o `.exe` com o botão direito > **Executar como administrador**. O instalador gráfico inclui o executável Windows x64 e não precisa de PowerShell, código-fonte, Node.js, npm ou `node_modules` no totem.

O código temporário vence em 30 minutos. O instalador entregue para o Totem Pompeia já abre com o código de pareamento no campo oculto; use esse executável dentro do prazo. Para outro dispositivo, use **Abrir console** para gerar um código novo. O valor não entra nos registros. O instalador protege a configuração para SYSTEM e administradores locais, registra a tarefa no Agendador de Tarefas e inicia o agente. Instalações seguintes preservam o pareamento e o journal local.

O destino padrão é `C:\ProgramData\SenhaHub\PrintAgent`, em disco local NTFS. O `.exe` inclui runtime Node 24, SQLite e o módulo serial nativo do Windows x64.

## Instalação pela interface gráfica

1. Copie `SenhaHub.PrintAgent.Node-Setup.exe` para o totem e abra-o. O Windows solicitará elevação de administrador.
2. Confirme a porta da Bematech. O instalador mantém `COM5` selecionável mesmo se o Windows não a enumerar; nesse caso, confirme cabo e driver antes de testar impressão.
3. Confira o campo oculto do código (já preenchido no executável do Totem Pompeia) e clique em **Instalar e iniciar agente**.
4. Acompanhe o resultado no registro exibido pela janela. O instalador aguarda até 60 segundos pelo primeiro bootstrap autenticado.

Se a tarefa for criada, mas o bootstrap depender de internet ou de um código expirado, a janela informa o caminho do log. Gere um código novo no console e execute novamente; uma sessão local já salva será preservada.

O pacote `.zip` com os scripts de diagnóstico continua disponível para suporte, mas não é necessário para a instalação gráfica.

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

O script cria `windows\print-agent-node\artifacts\SenhaHub.PrintAgent.Node.exe`, `SenhaHub.PrintAgent.Node-Setup.exe` e `SenhaHub.PrintAgent.Node-Setup.zip`. O código só é embutido quando informado no parâmetro `-PairingCode`; o padrão gera um instalador sem código. O campo permanece mascarado e o código não aparece nos logs.
