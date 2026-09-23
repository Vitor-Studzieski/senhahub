# Diagnóstico do agente de impressão

O executável `SenhaHub.PrintAgent.Diagnostic-v1.0.3.exe` verifica o tempo desde a inicialização do Windows, eventos de suspensão/retomada, serviços do agente, configuração, porta serial, registros locais, reinícios do watchdog e autenticação com o servidor. Ele reconhece as instalações do Totem MP-4000 TH FI e do agente x86/MP-4200 TH.

Execute no mini PC como administrador. O relatório aparece na janela e pode ser copiado. O utilitário não envia cupom, não inicia nem para o serviço e não altera arquivos de configuração.

Quando o serviço está parado, o diagnóstico consulta a recuperação da fila no servidor. Essa é a mesma operação de recuperação executada pelo agente ao iniciar: ela pode atualizar leases já vencidos para `retry_wait` ou `needs_review`, mas nunca reivindica um trabalho nem manda impressão. Quando o serviço está em execução, o utilitário não consulta a recuperação para evitar interferir em um envio ativo.

## Interpretar resultado incerto

Se aparecer **A impressora está bloqueada para revisão**, uma tentativa começou e o sistema não recebeu confirmação segura do resultado físico. Confira se a senha saiu. Depois, um administrador deve resolver o trabalho pendente no painel de impressão. Se a senha não saiu, escolha a ação de reimpressão após a verificação; se saiu, confirme a impressão. A trava existe para evitar duplicidade.

Se a porta COM não aparecer, confira cabo USB, driver Bematech e a porta configurada. Se aparecer HTTP 401/403 ou erro de escopo, confira o pareamento e o vínculo do dispositivo com o Açougue 2.

## Compilar

Em Windows com Visual Studio ou Build Tools e .NET Framework 4.8:

```powershell
.\build.ps1
```

Os artefatos serão criados em `artifacts\SenhaHub.PrintAgent.Diagnostic.exe` e `artifacts\SenhaHub.PrintAgent.Diagnostic-v1.0.3.exe`.
