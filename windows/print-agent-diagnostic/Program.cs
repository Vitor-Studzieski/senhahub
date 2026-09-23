using System;
using System.Collections.Generic;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SenhaHub.PrintAgent.Diagnostic
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Application.Run(new DiagnosticForm());
        }
    }

    internal sealed class DiagnosticForm : Form
    {
        private readonly TextBox report = new TextBox();
        private readonly Label summary = new Label();
        private readonly Button runButton = new Button();
        private readonly Button copyButton = new Button();

        public DiagnosticForm()
        {
            Text = "Diagnóstico de impressão — SenhaHub";
            ClientSize = new Size(780, 610);
            MinimumSize = new Size(700, 520);
            StartPosition = FormStartPosition.CenterScreen;

            var title = new Label
            {
                Text = "Diagnóstico do mini PC e da fila de impressão",
                Font = new Font("Segoe UI", 15, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(20, 18)
            };
            Controls.Add(title);

            summary.SetBounds(20, 55, 740, 38);
            summary.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            summary.ForeColor = Color.DarkSlateGray;
            summary.Text = "Clique em Gerar diagnóstico para verificar o equipamento.";
            Controls.Add(summary);

            report.SetBounds(20, 100, 740, 430);
            report.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            report.Multiline = true;
            report.ReadOnly = true;
            report.WordWrap = false;
            report.ScrollBars = ScrollBars.Both;
            report.Font = new Font("Consolas", 9);
            Controls.Add(report);

            runButton.Text = "Gerar diagnóstico";
            runButton.SetBounds(20, 548, 170, 36);
            runButton.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            runButton.Click += async delegate { await RunDiagnosticsAsync(); };
            Controls.Add(runButton);

            copyButton.Text = "Copiar relatório";
            copyButton.SetBounds(200, 548, 150, 36);
            copyButton.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            copyButton.Enabled = false;
            copyButton.Click += delegate
            {
                if (!string.IsNullOrWhiteSpace(report.Text)) Clipboard.SetText(report.Text);
            };
            Controls.Add(copyButton);

            var footer = new Label
            {
                Text = "O diagnóstico não imprime senha de teste nem altera a configuração local.",
                AutoSize = true,
                ForeColor = Color.DimGray,
                Location = new Point(365, 558),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Right
            };
            Controls.Add(footer);
        }

        private async Task RunDiagnosticsAsync()
        {
            runButton.Enabled = false;
            copyButton.Enabled = false;
            summary.Text = "Analisando serviço, porta, registros e conexão com o SenhaHub...";
            summary.ForeColor = Color.DarkSlateGray;
            report.Text = "Aguarde...";

            try
            {
                var result = await Task.Run(() => DiagnosticRunner.Run());
                report.Text = result.Text;
                summary.Text = result.Summary;
                summary.ForeColor = result.HasError ? Color.Firebrick : (result.HasWarning ? Color.DarkOrange : Color.DarkGreen);
                copyButton.Enabled = true;
            }
            catch (Exception error)
            {
                report.Text = "Não foi possível concluir o diagnóstico.\r\n\r\n" + error.Message;
                summary.Text = "O diagnóstico encontrou uma falha.";
                summary.ForeColor = Color.Firebrick;
            }
            finally
            {
                runButton.Enabled = true;
            }
        }
    }

    internal sealed class DiagnosticResult
    {
        public string Summary;
        public string Text;
        public bool HasError;
        public bool HasWarning;
    }

    internal sealed class AgentProfile
    {
        public string Name;
        public string ServiceName;
        public string StateLogName;
        public string DefaultPort;
        public string AgentVersion;
        public string Root;
        public string ConfigPath { get { return Path.Combine(Root, "agent.env"); } }
    }

    internal sealed class AgentConfiguration
    {
        public string ApiUrl;
        public string LocalToken;
        public string PrinterMode;
        public string PrinterName;
        public string PrinterPort;
        public string StateDirectory;
        public Dictionary<string, string> Values;
    }

    internal static class DiagnosticRunner
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 * 2 };
        private static readonly StringBuilder Output = new StringBuilder();
        private static bool hasError;
        private static bool hasWarning;

        public static DiagnosticResult Run()
        {
            Output.Clear();
            hasError = false;
            hasWarning = false;
            Output.AppendLine("SENHAHUB — DIAGNÓSTICO DE IMPRESSÃO");
            Output.AppendLine("Gerado em: " + DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"));
            Output.AppendLine("Computador: " + Environment.MachineName);
            Output.AppendLine("Executado como: " + Environment.UserName);
            Output.AppendLine(new string('=', 76));
            CheckWindowsUptimeAndPowerHistory();

            var profiles = FindProfiles();
            if (profiles.Count == 0)
            {
                Error("Agente não encontrado", "Não encontrei a configuração do agente em C:\\ProgramData\\SenhaHub.\r\nConfirme se este mini PC tem o agente do SenhaHub instalado.");
            }
            else
            {
                foreach (var profile in profiles) RunProfile(profile);
            }

            Output.AppendLine();
            Output.AppendLine("LEITURA DO SINTOMA");
            Output.AppendLine("Se o relatório apontar 'revisão necessária' ou impressora bloqueada, o agente" +
                " perdeu a confirmação após começar um envio. Verifique fisicamente se a senha" +
                " saiu e resolva o trabalho no painel administrativo; o sistema bloqueia novas" +
                " impressões para evitar duplicidade.");
            Output.AppendLine("Se a senha não aparece no painel ou o agente não informa bloqueio, confira" +
                " se o tablet está vinculado ao Açougue 2 e se a solicitação chegou à fila.");
            Output.AppendLine();
            Output.AppendLine("Nenhum cupom ou senha de teste foi enviado.");

            var summary = hasError ? "Diagnóstico concluído: encontrei uma falha que pode impedir a impressão." :
                hasWarning ? "Diagnóstico concluído: encontrei um ponto que precisa de atenção." :
                "Diagnóstico concluído: serviço, configuração e comunicação estão acessíveis.";
            return new DiagnosticResult { Summary = summary, Text = Output.ToString(), HasError = hasError, HasWarning = hasWarning };
        }

        private static void CheckWindowsUptimeAndPowerHistory()
        {
            Section("Energia e tempo ligado");
            try
            {
                var bootTime = DateTime.Now - TimeSpan.FromMilliseconds(GetTickCount64());
                Ok("Windows iniciado", bootTime.ToString("dd/MM/yyyy HH:mm:ss") + " (horário local aproximado).");
            }
            catch
            {
                Warning("Tempo ligado não identificado", "Não foi possível ler o horário da última inicialização do Windows.");
            }

            try
            {
                var cutoff = DateTime.Now.AddHours(-48);
                var events = new List<string>();
                using (var systemLog = new EventLog("System"))
                {
                    var entries = systemLog.Entries;
                    var first = Math.Max(0, entries.Count - 1500);
                    for (var index = entries.Count - 1; index >= first; index--)
                    {
                        var entry = entries[index];
                        if (entry.TimeGenerated < cutoff) break;
                        var source = entry.Source ?? "";
                        var eventId = entry.InstanceId & 0xffff;
                        if ((source.IndexOf("Kernel-Power", StringComparison.OrdinalIgnoreCase) >= 0 && (eventId == 42 || eventId == 107)) ||
                            (source.IndexOf("Power-Troubleshooter", StringComparison.OrdinalIgnoreCase) >= 0 && eventId == 1))
                        {
                            var action = eventId == 42 ? "entrou em suspensão" : "retomou da suspensão";
                            events.Add(entry.TimeGenerated.ToString("dd/MM HH:mm:ss") + " — Windows " + action + " (" + source + ", evento " + eventId + ")");
                        }
                    }
                }

                if (events.Count == 0)
                    Ok("Histórico de suspensão", "Nenhuma suspensão/retomada foi encontrada no log do Windows nas últimas 48 horas.");
                else
                {
                    Warning("Suspensão do Windows registrada", "Se havia uma senha em impressão nesse horário, a pausa pode ter vencido a reserva e deixado o trabalho para revisão.");
                    foreach (var item in events.Take(8)) Output.AppendLine("  " + item);
                }
            }
            catch (Exception error)
            {
                Warning("Histórico de energia indisponível", "Não foi possível ler o log System: " + SafeMessage(error.Message));
            }
        }

        [DllImport("kernel32.dll")]
        private static extern ulong GetTickCount64();

        private static List<AgentProfile> FindProfiles()
        {
            var basePath = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            var profiles = new List<AgentProfile>
            {
                new AgentProfile
                {
                    Name = "Totem MP-4000 TH FI",
                    ServiceName = "SenhaHubPrintAgentTotem",
                    StateLogName = "print-agent-totem.log",
                    DefaultPort = "COM3",
                    AgentVersion = "totem-mp4000-th-fi/1.0.0",
                    Root = Path.Combine(basePath, "SenhaHub", "PrintAgentTotem")
                },
                new AgentProfile
                {
                    Name = "Agente x86 / MP-4200 TH",
                    ServiceName = "SenhaHubPrintAgentX86",
                    StateLogName = "print-agent-x86.log",
                    DefaultPort = "COM5",
                    AgentVersion = "windows-x86/1.2.8",
                    Root = Path.Combine(basePath, "SenhaHub", "PrintAgentX86")
                }
            };
            return profiles.Where(p => File.Exists(p.ConfigPath) || ServiceExists(p.ServiceName)).ToList();
        }

        private static bool ServiceExists(string serviceName)
        {
            try { return ServiceController.GetServices().Any(s => string.Equals(s.ServiceName, serviceName, StringComparison.OrdinalIgnoreCase)); }
            catch { return false; }
        }

        private static void RunProfile(AgentProfile profile)
        {
            Section(profile.Name);
            Output.AppendLine("Pasta: " + profile.Root);

            AgentConfiguration config = null;
            try
            {
                if (!File.Exists(profile.ConfigPath))
                {
                    Error("Configuração ausente", "Não encontrei " + profile.ConfigPath + ".");
                }
                else
                {
                    config = ReadConfiguration(profile);
                    Ok("Configuração lida", "Servidor " + SafeHost(config.ApiUrl) + "; modo " + config.PrinterMode + "; estado local " + config.StateDirectory + ".");
                    CheckPrinter(profile, config);
                }
            }
            catch (Exception error)
            {
                Error("Configuração inválida", SafeMessage(error.Message));
            }

            var serviceStatus = CheckService(profile);
            CheckLogs(profile, config, serviceStatus);

            if (config != null)
            {
                try
                {
                    CheckServer(profile, config, serviceStatus);
                }
                catch (Exception error)
                {
                    var message = SafeMessage(error.Message);
                    if (message.Contains("HTTP 401"))
                        Error("Sessão do dispositivo recusada", message + " O agente pode tentar renovar a sessão; se o erro continuar, confira o pareamento.");
                    else if (message.Contains("HTTP 403"))
                        Error("Dispositivo sem autorização", message + " Confira se o equipamento continua ativo e vinculado ao Açougue 2.");
                    else if (message.Contains("HTTP 503"))
                        Error("Servidor de impressão indisponível", message + " Confira o status do SenhaHub e tente novamente.");
                    else
                        Warning("Servidor não consultado", message);
                }
            }
        }

        private static AgentConfiguration ReadConfiguration(AgentProfile profile)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(profile.ConfigPath, Encoding.UTF8))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var split = line.IndexOf('=');
                if (split <= 0) continue;
                var key = line.Substring(0, split).Trim();
                var value = line.Substring(split + 1).Trim();
                if (value.Length >= 2 && ((value[0] == '"' && value[value.Length - 1] == '"') || (value[0] == '\'' && value[value.Length - 1] == '\'')))
                    value = value.Substring(1, value.Length - 2);
                values[key] = value;
            }

            string api;
            values.TryGetValue("PRINT_API_URL", out api);
            api = string.IsNullOrWhiteSpace(api) ? "https://senhahub.vercel.app" : api.Trim().TrimEnd(new[] { '/' });
            Uri uri;
            if (!Uri.TryCreate(api, UriKind.Absolute, out uri) || (uri.Scheme != "https" && !(uri.IsLoopback && uri.Scheme == "http")))
                throw new InvalidOperationException("PRINT_API_URL precisa ser uma URL HTTPS válida.");

            string mode;
            values.TryGetValue("KIOSK_PRINTER_MODE", out mode);
            mode = string.IsNullOrWhiteSpace(mode) ? (profile.ServiceName.EndsWith("Totem", StringComparison.OrdinalIgnoreCase) ? "mp4000-serial" : "native-serial") : mode.Trim().ToLowerInvariant();
            string port;
            values.TryGetValue("KIOSK_PRINTER_PORT", out port);
            port = string.IsNullOrWhiteSpace(port) ? profile.DefaultPort : port.Trim();
            string printer;
            values.TryGetValue("KIOSK_PRINTER_NAME", out printer);
            string stateDir;
            values.TryGetValue("PRINT_AGENT_STATE_DIR", out stateDir);
            stateDir = string.IsNullOrWhiteSpace(stateDir) ? Path.Combine("data", profile.ServiceName.EndsWith("Totem", StringComparison.OrdinalIgnoreCase) ? "print-agent-totem" : "print-agent-x86") : stateDir;
            if (!Path.IsPathRooted(stateDir)) stateDir = Path.Combine(profile.Root, stateDir);

            string token;
            values.TryGetValue("PRINT_DEVICE_LOCAL_TOKEN", out token);
            return new AgentConfiguration
            {
                ApiUrl = api,
                LocalToken = token ?? "",
                PrinterMode = mode,
                PrinterName = printer ?? "",
                PrinterPort = port,
                StateDirectory = stateDir,
                Values = values
            };
        }

        private static void CheckPrinter(AgentProfile profile, AgentConfiguration config)
        {
            if (config.PrinterMode == "spooler")
            {
                var found = System.Drawing.Printing.PrinterSettings.InstalledPrinters.Cast<string>()
                    .FirstOrDefault(n => string.Equals(n, config.PrinterName, StringComparison.OrdinalIgnoreCase));
                if (found == null) Error("Fila do Windows não encontrada", "A fila configurada '" + config.PrinterName + "' não está instalada.");
                else Ok("Fila do Windows encontrada", found);
                return;
            }

            var ports = SerialPort.GetPortNames().OrderBy(p => p).ToArray();
            if (ports.Contains(config.PrinterPort, StringComparer.OrdinalIgnoreCase))
                Ok("Porta serial encontrada", config.PrinterPort + " aparece no Windows (" + string.Join(", ", ports) + "). Isso confirma o driver/porta, mas não confirma papel, energia ou comunicação física com a impressora.");
            else
                Error("Porta serial não encontrada", "A configuração aponta para " + config.PrinterPort + ", mas as portas disponíveis são " + (ports.Length == 0 ? "nenhuma" : string.Join(", ", ports)) + ". Confira cabo USB, driver Bematech e porta COM configurada.");
        }

        private static string CheckService(AgentProfile profile)
        {
            try
            {
                using (var service = new ServiceController(profile.ServiceName))
                {
                    var status = service.Status;
                    var startType = ReadStartType(profile.ServiceName);
                    if (status == ServiceControllerStatus.Running)
                        Ok("Serviço do agente em execução", profile.ServiceName + "; início " + startType + ".");
                    else if (status == ServiceControllerStatus.Stopped)
                        Error("Serviço do agente parado", profile.ServiceName + " está parado; início configurado: " + startType + ". Abra Serviços do Windows e inicie o agente depois de corrigir a causa indicada abaixo.");
                    else
                        Warning("Serviço do agente", profile.ServiceName + " está " + status + "; início " + startType + ".");
                    return status.ToString();
                }
            }
            catch (InvalidOperationException)
            {
                Error("Serviço não instalado", "Não encontrei " + profile.ServiceName + " no Windows.");
                return "Missing";
            }
            catch (Exception error)
            {
                Warning("Estado do serviço indisponível", profile.ServiceName + ": " + SafeMessage(error.Message));
                return "Unknown";
            }
        }

        private static string ReadStartType(string serviceName)
        {
            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + serviceName))
                {
                    var value = key == null ? null : key.GetValue("Start");
                    if (value == null) return "desconhecido";
                    switch (Convert.ToInt32(value))
                    {
                        case 2: return "automático";
                        case 3: return "manual";
                        case 4: return "desativado";
                        default: return "sistema";
                    }
                }
            }
            catch { return "desconhecido"; }
        }

        private static void CheckLogs(AgentProfile profile, AgentConfiguration config, string serviceStatus)
        {
            var directory = config == null ? Path.Combine(profile.Root, "data", profile.ServiceName.EndsWith("Totem", StringComparison.OrdinalIgnoreCase) ? "print-agent-totem" : "print-agent-x86") : config.StateDirectory;
            var logPath = Path.Combine(directory, profile.StateLogName);
            if (File.Exists(logPath))
            {
                try
                {
                    var lines = File.ReadAllLines(logPath, Encoding.UTF8);
                    if (lines.Length == 0) Warning("Log do agente vazio", logPath);
                    else
                    {
                        var last = lines[lines.Length - 1];
                        Ok("Log encontrado", "Última atividade: " + TrimForDisplay(last, 250));
                        var clues = lines.Where(IsUsefulLogLine).ToArray();
                        if (clues.Length > 12) clues = clues.Skip(clues.Length - 12).ToArray();
                        if (clues.Length > 0)
                        {
                            Output.AppendLine("  Eventos relevantes recentes:");
                            foreach (var clue in clues) Output.AppendLine("    " + TrimForDisplay(clue, 300));
                            ClassifyLogs(clues);
                        }
                    }
                }
                catch (Exception error)
                {
                    Warning("Log não pôde ser lido", SafeMessage(error.Message));
                }
            }
            else
            {
                Warning("Log do agente ausente", "Não encontrei " + logPath + ".");
            }

            var startupPath = Path.Combine(profile.Root, "service-startup.log");
            if (File.Exists(startupPath))
            {
                var startupLines = File.ReadAllLines(startupPath, Encoding.UTF8);
                if (startupLines.Length > 0)
                {
                    var marker = Array.FindLastIndex(startupLines, line => System.Text.RegularExpressions.Regex.IsMatch(line, @"^\d{4}-\d{2}-\d{2}T"));
                    var detail = marker >= 0 ? startupLines[marker] : startupLines[0];
                    var recordedAt = File.GetLastWriteTime(startupPath).ToString("dd/MM/yyyy HH:mm:ss");
                    if (string.Equals(serviceStatus, "Running", StringComparison.OrdinalIgnoreCase))
                        Output.AppendLine("[HISTÓRICO] O arquivo de inicialização contém uma falha anterior (" + recordedAt + "): " + TrimForDisplay(detail, 400));
                    else if (File.GetLastWriteTime(startupPath) > DateTime.Now.AddHours(-6))
                        Error("Falha recente ao iniciar agente", "Registro de " + recordedAt + ": " + TrimForDisplay(detail, 400));
                    else
                        Output.AppendLine("[HISTÓRICO] O arquivo de inicialização contém uma falha anterior (" + recordedAt + "): " + TrimForDisplay(detail, 400));
                }
            }

            var watchdogPath = Path.Combine(profile.Root, "agent-watchdog.log");
            if (File.Exists(watchdogPath))
            {
                var watchdogLines = File.ReadAllLines(watchdogPath, Encoding.UTF8);
                if (watchdogLines.Length > 0)
                    Warning("Reinício automático registrado", TrimForDisplay(watchdogLines[watchdogLines.Length - 1], 400));
            }
        }

        private static bool IsUsefulLogLine(string line)
        {
            return line.IndexOf("ERROR", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   line.IndexOf("needs_review", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   line.IndexOf("bloqueada para revisão", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   line.IndexOf("bloqueada para revisao", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   line.IndexOf("Trabalho de impressão confirmado", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void ClassifyLogs(IEnumerable<string> lines)
        {
            var text = string.Join("\n", lines).ToLowerInvariant();
            if (text.Contains("bloqueada para revisão") || text.Contains("bloqueada para revisao") || text.Contains("needs_review") || text.Contains("resultado físico incerto") || text.Contains("resultado fisico incerto"))
                Error("Revisão necessária", "O agente registrou uma impressão de resultado incerto. O servidor bloqueia a fila para evitar duplicidade; confira se o papel saiu e resolva a senha pendente no painel administrativo.");
            if (text.Contains("sem autorização") || text.Contains("sem autorizacao") || text.Contains("device_revoked") || text.Contains("device_scope_invalid") || text.Contains("status\":401") || text.Contains("status\":403"))
                Error("Autorização do agente recusada", "O registro mostra HTTP 401/403 ou dispositivo revogado/fora do escopo. Confira pareamento e vínculo do equipamento no painel.");
            if (text.Contains("autenticacao/conexao indisponivel") || text.Contains("autenticação/conexão indisponível") || text.Contains("name resolution") || text.Contains("could not resolve") || text.Contains("sem conexão") || text.Contains("sem conexao"))
                Warning("Conexão com o servidor falhou", "O log registra falha de conexão/autenticação. Verifique internet, DNS, data/hora do Windows e acesso HTTPS ao SenhaHub.");
            if (text.Contains("impressora indisponível antes do envio") || text.Contains("impressora indisponivel antes do envio") || text.Contains("porta com") || text.Contains("access is denied") || text.Contains("acesso negado"))
                Warning("Falha local de impressora registrada", "O log indica porta/dispositivo indisponível. Confira cabo, driver, porta COM, alimentação e tampa da impressora.");
        }

        private static void CheckServer(AgentProfile profile, AgentConfiguration config, string serviceStatus)
        {
            var token = LoadToken(config);
            if (string.IsNullOrWhiteSpace(token))
            {
                Warning("Conexão autenticada não testada", "Não encontrei uma sessão local legível. Execute este diagnóstico como administrador ou consulte os erros de pareamento no log.");
                return;
            }

            var bootstrap = Post(profile, config, token, "bootstrap", new Dictionary<string, object>());
            var device = GetObject(bootstrap, "device");
            var store = GetString(device, "storeCode");
            var kiosk = GetString(device, "kioskId");
            Ok("Servidor e autorização do dispositivo", "A API respondeu; loja " + (store ?? "não informada") + "; destino " + (kiosk ?? "não informado") + ".");

            if (string.Equals(serviceStatus, "Stopped", StringComparison.OrdinalIgnoreCase) || string.Equals(serviceStatus, "Missing", StringComparison.OrdinalIgnoreCase))
            {
                var recovery = Post(profile, config, token, "recover", new Dictionary<string, object>());
                ReportQueueState(recovery);
            }
            else if (string.Equals(serviceStatus, "Running", StringComparison.OrdinalIgnoreCase))
            {
                Output.AppendLine("[INFO] Fila remota não consultada — o serviço está ativo; a consulta de recuperação foi pulada para não interferir em uma impressão em andamento.");
            }
            else
            {
                Warning("Fila remota não consultada", "O serviço não está parado nem confirmado como ativo. A consulta de recuperação pode interferir em um trabalho em andamento.");
            }
        }

        private static void ReportQueueState(Dictionary<string, object> recovery)
        {
            var job = GetObject(recovery, "job");
            var status = GetString(job, "status");
            var blocked = GetBool(recovery, "blocked");
            var lastError = GetString(job, "last_error");
            if (blocked || string.Equals(status, "needs_review", StringComparison.OrdinalIgnoreCase))
            {
                Error("A impressora está bloqueada para revisão", "O servidor confirmou que há um trabalho com resultado físico incerto." +
                    (string.IsNullOrWhiteSpace(lastError) ? "" : " Motivo registrado: " + SafeMessage(lastError)) +
                    " Confira a impressora e resolva esse trabalho no painel antes de tentar outra senha.");
                return;
            }
            if (string.Equals(status, "printing", StringComparison.OrdinalIgnoreCase) || string.Equals(status, "leased", StringComparison.OrdinalIgnoreCase))
            {
                Warning("Trabalho ainda reservado", "O servidor tem um trabalho em estado '" + status + "'. Aguarde a recuperação automática e não reinicie o mini PC enquanto a impressora estiver trabalhando.");
                return;
            }
            var next = GetString(recovery, "nextAttemptAt");
            if (!string.IsNullOrWhiteSpace(next))
            {
                Warning("Trabalho aguardando nova tentativa", "A fila informa próxima tentativa em " + next + ".");
                return;
            }
            Ok("Fila sem bloqueio de execução", "O servidor não informou trabalho ativo nem bloqueio por resultado incerto. Se uma nova senha ainda falhar, confira se o totem/tablet está vinculado ao Açougue 2 e se o pedido foi aceito.");
        }

        private static Dictionary<string, object> Post(AgentProfile profile, AgentConfiguration config, string token, string command, Dictionary<string, object> body)
        {
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromSeconds(15);
                using (var request = new HttpRequestMessage(HttpMethod.Post, config.ApiUrl + "/api/print/v2/" + command))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    request.Headers.Add("x-print-agent-version", profile.AgentVersion);
                    request.Content = new StringContent(Json.Serialize(body), Encoding.UTF8, "application/json");
                    using (var response = client.SendAsync(request).GetAwaiter().GetResult())
                    {
                        var responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                        if (!response.IsSuccessStatusCode)
                        {
                            string error;
                            try { error = GetString(Json.DeserializeObject(responseBody) as Dictionary<string, object>, "error"); }
                            catch { error = null; }
                            throw new InvalidOperationException("A API respondeu HTTP " + (int)response.StatusCode + (string.IsNullOrWhiteSpace(error) ? "." : ": " + SafeMessage(error)));
                        }
                        return Json.DeserializeObject(responseBody) as Dictionary<string, object> ?? new Dictionary<string, object>();
                    }
                }
            }
        }

        private static string LoadToken(AgentConfiguration config)
        {
            if (!string.IsNullOrWhiteSpace(config.LocalToken)) return config.LocalToken.Trim();
            var statePath = Path.Combine(config.StateDirectory, "agent-state.bin");
            if (!File.Exists(statePath)) return null;
            var clear = ProtectedData.Unprotect(File.ReadAllBytes(statePath), null, DataProtectionScope.LocalMachine);
            var state = Json.DeserializeObject(Encoding.UTF8.GetString(clear)) as Dictionary<string, object>;
            var session = GetObject(state, "session");
            return GetString(session, "accessToken");
        }

        private static string SafeHost(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) ? uri.Host : "servidor não validado";
        }

        private static string SafeMessage(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "sem detalhe adicional";
            value = value.Replace("\r", " ").Replace("\n", " ").Trim();
            // Avoid copying bearer tokens or enrollment codes into the visible report.
            value = System.Text.RegularExpressions.Regex.Replace(value, @"(?i)(bearer\s+)[A-Za-z0-9._~-]+", "$1[oculto]");
            value = System.Text.RegularExpressions.Regex.Replace(value, @"\b[A-Za-z0-9_-]{32}\b", "[código oculto]");
            return value.Length > 500 ? value.Substring(0, 500) : value;
        }

        private static string TrimForDisplay(string value, int max)
        {
            value = SafeMessage(value);
            return value.Length > max ? value.Substring(0, max) + "…" : value;
        }

        private static string GetString(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return null;
            return Convert.ToString(value[key]);
        }

        private static Dictionary<string, object> GetObject(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return null;
            return value[key] as Dictionary<string, object>;
        }

        private static bool GetBool(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return false;
            try { return Convert.ToBoolean(value[key]); } catch { return false; }
        }

        private static void Section(string title)
        {
            Output.AppendLine();
            Output.AppendLine("[" + title.ToUpperInvariant() + "]");
        }

        private static void Ok(string title, string detail)
        {
            Output.AppendLine("[OK] " + title + " — " + detail);
        }

        private static void Warning(string title, string detail)
        {
            hasWarning = true;
            Output.AppendLine("[ATENÇÃO] " + title + " — " + detail);
        }

        private static void Error(string title, string detail)
        {
            hasError = true;
            Output.AppendLine("[FALHA] " + title + " — " + detail);
        }
    }

}
