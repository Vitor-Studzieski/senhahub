using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SenhaHub.PrintAgent.Node.Setup
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!EnsureAdministrator()) return;
            Application.Run(new InstallerForm());
        }

        private static bool EnsureAdministrator()
        {
            using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
            {
                var principal = new System.Security.Principal.WindowsPrincipal(identity);
                if (principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)) return true;
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = Assembly.GetExecutingAssembly().Location,
                    WorkingDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
                    UseShellExecute = true,
                    Verb = "runas"
                });
            }
            catch (Exception error)
            {
                MessageBox.Show("O instalador precisa de permissão de administrador para reparar a pasta em ProgramData e criar a tarefa automática. " + error.Message +
                    Environment.NewLine + Environment.NewLine + "Feche esta janela e abra o arquivo .exe com o botão direito > Executar como administrador.",
                    "Permissão necessária", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return false;
        }
    }

    internal sealed class InstallerForm : Form
    {
        private const string TaskName = "SenhaHub - Agente de Impressao";
        private const string ServerUrl = "https://senhahub.vercel.app";
        private readonly TextBox apiUrl = new TextBox();
        private readonly TextBox enrollmentCode = new TextBox();
        private readonly ComboBox printerPort = new ComboBox();
        private readonly Label status = new Label();
        private readonly TextBox log = new TextBox();
        private readonly Button installButton = new Button();
        private readonly Button diagnoseButton = new Button();
        private readonly Button refreshButton = new Button();

        public InstallerForm()
        {
            Text = "Instalador do agente Node — SenhaHub";
            ClientSize = new Size(700, 500);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;

            var title = new Label
            {
                Text = "Instalação do agente de impressão",
                Font = new Font("Segoe UI", 16, FontStyle.Bold),
                AutoSize = true
            };
            title.SetBounds(22, 16, 640, 32);
            Controls.Add(title);

            AddLabel("Servidor SenhaHub", 24, 64);
            apiUrl.SetBounds(24, 87, 500, 27);
            apiUrl.Text = ServerUrl;
            Controls.Add(apiUrl);
            var openConsoleButton = new Button { Text = "Abrir console" };
            openConsoleButton.SetBounds(538, 86, 138, 29);
            openConsoleButton.Click += delegate { OpenConsole(); };
            Controls.Add(openConsoleButton);

            AddLabel("Código temporário de pareamento (válido por 30 minutos)", 24, 128);
            enrollmentCode.SetBounds(24, 151, 652, 27);
            enrollmentCode.UseSystemPasswordChar = true;
            enrollmentCode.Text = ReadPrefilledEnrollmentCode();
            Controls.Add(enrollmentCode);
            var revealCode = new CheckBox { Text = "Mostrar código", AutoSize = true };
            revealCode.SetBounds(24, 183, 150, 22);
            revealCode.CheckedChanged += delegate { enrollmentCode.UseSystemPasswordChar = !revealCode.Checked; };
            Controls.Add(revealCode);
            var hint = new Label
            {
                Text = "Na primeira instalação, gere um código novo no console e cole acima. O código não aparece nos registros.",
                AutoSize = true,
                ForeColor = Color.DimGray
            };
            hint.SetBounds(184, 185, 492, 20);
            Controls.Add(hint);

            AddLabel("Porta serial da Bematech", 24, 220);
            printerPort.SetBounds(24, 243, 145, 27);
            printerPort.DropDownStyle = ComboBoxStyle.DropDownList;
            Controls.Add(printerPort);
            refreshButton.Text = "Atualizar portas";
            refreshButton.SetBounds(181, 242, 130, 29);
            refreshButton.Click += delegate { LoadPorts(); };
            Controls.Add(refreshButton);

            installButton.Text = "Instalar e iniciar agente";
            installButton.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            installButton.BackColor = Color.FromArgb(255, 153, 0);
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.SetBounds(24, 286, 250, 42);
            installButton.Click += async delegate { await InstallAgentAsync(); };
            Controls.Add(installButton);

            diagnoseButton.Text = "Diagnosticar";
            diagnoseButton.SetBounds(284, 286, 145, 42);
            diagnoseButton.Click += async delegate { await DiagnoseAgentAsync(); };
            Controls.Add(diagnoseButton);

            status.AutoSize = false;
            status.SetBounds(444, 286, 232, 42);
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.ForeColor = Color.DimGray;
            Controls.Add(status);

            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.Font = new Font("Consolas", 9);
            log.SetBounds(24, 344, 652, 132);
            Controls.Add(log);

            Load += delegate { LoadPorts(); };
            WriteLog("Este instalador inclui o agente Node e não precisa de PowerShell, Node.js ou código-fonte.");
            WriteLog("A instalação preserva a sessão e o journal local quando já existem.");
        }

        private void AddLabel(string text, int x, int y)
        {
            var label = new Label { Text = text, AutoSize = true };
            label.SetBounds(x, y, 640, 20);
            Controls.Add(label);
        }

        private void OpenConsole()
        {
            try
            {
                Process.Start(new ProcessStartInfo(ServerUrl + "/admin/totens") { UseShellExecute = true });
            }
            catch (Exception error)
            {
                SetStatus("Não foi possível abrir o console: " + error.Message, true);
            }
        }

        private void LoadPorts()
        {
            var selected = printerPort.SelectedItem as string;
            printerPort.Items.Clear();
            string[] ports;
            try { ports = SerialPort.GetPortNames().OrderBy(p => p).ToArray(); }
            catch { ports = new string[0]; }

            foreach (var port in ports) printerPort.Items.Add(port);
            var com5Detected = ports.Any(port => String.Equals(port, "COM5", StringComparison.OrdinalIgnoreCase));
            if (!com5Detected) printerPort.Items.Add("COM5"); // Mantém seleção manual sem trocar para uma COM errada.

            if (!String.IsNullOrWhiteSpace(selected) && printerPort.Items.Contains(selected)) printerPort.SelectedItem = selected;
            else if (printerPort.Items.Contains("COM5")) printerPort.SelectedItem = "COM5";
            else if (printerPort.Items.Count > 0) printerPort.SelectedIndex = 0;

            WriteLog("Portas enumeradas: " + String.Join(", ", ports.Length == 0 ? new[] { "nenhuma" } : ports));
            if (!com5Detected)
                SetStatus("COM5 não foi detectada. Confirme o cabo e o driver no Gerenciador de Dispositivos antes de testar a impressão.", true);
        }

        private async Task InstallAgentAsync()
        {
            var url = apiUrl.Text.Trim().TrimEnd('/');
            var code = enrollmentCode.Text.Trim();
            var port = printerPort.SelectedItem as string;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps)
            {
                SetStatus("Informe um endereço HTTPS válido.", true);
                return;
            }
            if (!String.IsNullOrWhiteSpace(code) && !Regex.IsMatch(code, "^[A-Za-z0-9_-]{32}$"))
            {
                SetStatus("O código precisa ter 32 caracteres. Gere outro no console.", true);
                return;
            }
            if (String.IsNullOrWhiteSpace(port) || !Regex.IsMatch(port, "^COM[0-9]+$", RegexOptions.IgnoreCase))
            {
                SetStatus("Selecione uma porta no formato COM5.", true);
                return;
            }

            SetBusy(true);
            try
            {
                await Task.Run(() => InstallAgent(url, code, port));
                SetStatus("Instalação finalizada. Confira o resultado no registro abaixo.", false);
            }
            catch (Exception error)
            {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
                var report = BuildFailureReport(error, root);
                AppendOutput(report);
                SetStatus("Falha na instalação. Exceção e logs completos exibidos abaixo.", true);
                MessageBox.Show(this, error.Message + Environment.NewLine + Environment.NewLine + "A exceção completa e os logs estão na janela do instalador.",
                    "Falha na instalação", MessageBoxButtons.OK, MessageBoxIcon.Error);
                var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
                if (File.Exists(agentPath))
                {
                    try
                    {
                        var diagnostic = await Task.Run(() => RunProcess(agentPath, "--diagnose --local-only", root, 90000));
                        AppendOutput("DIAGNÓSTICO LOCAL AUTOMÁTICO" + Environment.NewLine + diagnostic.Output);
                        if (!String.IsNullOrWhiteSpace(diagnostic.Error)) AppendOutput(diagnostic.Error);
                    }
                    catch (Exception diagnosticError)
                    {
                        AppendOutput("O diagnóstico automático também falhou:" + Environment.NewLine + diagnosticError);
                    }
                }
            }
            finally { SetBusy(false); }
        }

        private async Task DiagnoseAgentAsync()
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
            var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
            if (!File.Exists(agentPath))
            {
                SetStatus("O agente ainda não está instalado.", true);
                WriteLog("Diagnóstico indisponível: instale o agente primeiro.");
                return;
            }

            SetBusy(true);
            try
            {
                SetStatus("Executando diagnóstico local...", false);
                var result = await Task.Run(() => RunProcess(agentPath, "--diagnose --local-only", root, 90000));
                AppendOutput(result.Output);
                if (!String.IsNullOrWhiteSpace(result.Error)) AppendOutput(result.Error);
                SetStatus(result.ExitCode == 0 ? "Diagnóstico concluído." : "Diagnóstico encontrou falhas; veja os detalhes abaixo.", result.ExitCode != 0);
            }
            catch (Exception error)
            {
                SetStatus("Falha no diagnóstico: " + error.Message, true);
                WriteLog("ERRO DE DIAGNÓSTICO: " + error);
            }
            finally { SetBusy(false); }
        }

        private void InstallAgent(string url, string code, string port)
        {
            if (!IsAdministrator())
                throw new InvalidOperationException("O instalador não está elevado como administrador. Feche esta janela e abra o .exe com o botão direito > Executar como administrador.");

            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
            var state = Path.Combine(root, "data", "print-agent");
            var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
            var configPath = Path.Combine(root, ".env.print-agent");
            var logPath = Path.Combine(state, "install.log");
            var aclRepairedDuringCreate = false;
            try { Directory.CreateDirectory(root); }
            catch (UnauthorizedAccessException)
            {
                // The directory can already exist with an old SYSTEM-only or deny ACL.
                RepairInstallFolderAcl(root);
                Directory.CreateDirectory(root);
                aclRepairedDuringCreate = true;
            }
            if (!aclRepairedDuringCreate) RepairInstallFolderAcl(root);
            Directory.CreateDirectory(state);

            LogTo(logPath, "Preparando instalação em " + root + ".");
            var hasSession = File.Exists(agentPath) && HasSavedSession(agentPath, root);

            StopExistingAgent(root, agentPath);
            if (File.Exists(agentPath)) File.SetAttributes(agentPath, FileAttributes.Normal);
            using (var source = OpenAgentPayload())
            using (var target = new FileStream(agentPath, FileMode.Create, FileAccess.Write, FileShare.None)) source.CopyTo(target);

            if (!hasSession && String.IsNullOrWhiteSpace(code))
                throw new InvalidOperationException("Esta primeira instalação precisa de um código novo. Gere no console, cole no campo do instalador e tente novamente.");

            var lines = File.Exists(configPath) ? File.ReadAllLines(configPath, Encoding.UTF8).ToList() : new List<string>();
            SetConfigValue(lines, "PRINT_API_URL", url);
            SetConfigValue(lines, "KIOSK_PRINTER_PORT", port.ToUpperInvariant());
            SetConfigValue(lines, "PRINT_SERIAL_BAUD_RATE", "115200");
            SetConfigValue(lines, "PRINT_SERIAL_DATA_BITS", "8");
            SetConfigValue(lines, "PRINT_SERIAL_STOP_BITS", "1");
            SetConfigValue(lines, "PRINT_SERIAL_PARITY", "none");
            SetConfigValue(lines, "PRINT_SERIAL_RTSCTS", "0");
            SetConfigValue(lines, "PRINT_AGENT_STATE_DIR", state);
            if (hasSession)
            {
                SetConfigValue(lines, "PRINT_ENROLLMENT_CODE", "");
                LogTo(logPath, "Sessão pareada encontrada; sessão e journal serão preservados.");
            }
            else
            {
                SetConfigValue(lines, "PRINT_ENROLLMENT_CODE", code);
                LogTo(logPath, "Código temporário recebido. O valor não é gravado no registro.");
            }
            if (!lines.Any(line => line.Trim().Equals("PRINT_REALTIME_ENABLED=1", StringComparison.OrdinalIgnoreCase)))
                SetConfigValue(lines, "PRINT_REALTIME_ENABLED", "1");
            File.WriteAllLines(configPath, lines, new UTF8Encoding(false));

            RegisterScheduledTask(root, agentPath);
            LogTo(logPath, "Tarefa automática registrada. Iniciando o agente.");
            RunProcess(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), "/Run /TN " + Quote(TaskName), root, true, 30000);

            var agentLog = Path.Combine(state, "print-agent.log");
            var deadline = DateTime.UtcNow.AddSeconds(60);
            while (DateTime.UtcNow < deadline)
            {
                if (File.Exists(agentLog))
                {
                    string[] logLines;
                    try { logLines = File.ReadAllLines(agentLog, Encoding.UTF8); } catch { logLines = new string[0]; }
                    var boot = logLines.LastOrDefault(line => line.Contains("INFO Agente v2 iniciado."));
                    if (!String.IsNullOrWhiteSpace(boot))
                    {
                        LogTo(logPath, "Agente autenticado e iniciado.");
                        LogTo(logPath, boot);
                        if (!hasSession) ClearEnrollmentCode(configPath);
                        return;
                    }
                }
                System.Threading.Thread.Sleep(1500);
            }

            var tail = ReadTail(agentLog, 12);
            LogTo(logPath, "A tarefa foi instalada, mas o bootstrap não foi confirmado em 60 segundos.");
            if (tail.Length > 0) LogTo(logPath, tail);
            throw new InvalidOperationException("A tarefa automática foi criada, mas o agente ainda não autenticou. Confira internet, horário do Windows e se o código está dentro dos 30 minutos. O detalhe está em " + logPath + ".");
        }

        private static bool HasSavedSession(string agentPath, string root)
        {
            var database = Path.Combine(root, "data", "print-agent", "agent-v2.sqlite");
            if (!File.Exists(database)) return false;
            var result = RunProcess(agentPath, "--diagnose --local-only --json --preinstall", root, 30000);
            var output = result.Output ?? String.Empty;
            return output.IndexOf("Sessão pareada", StringComparison.OrdinalIgnoreCase) >= 0
                && output.IndexOf("Conexão e sessão salvas no SQLite", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void SetConfigValue(List<string> lines, string key, string value)
        {
            var prefix = key + "=";
            var index = lines.FindIndex(line => line.TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            if (index >= 0) lines[index] = prefix + value;
            else lines.Add(prefix + value);
            for (var i = lines.Count - 1; i > index && index >= 0; i--)
                if (lines[i].TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) lines.RemoveAt(i);
        }

        private static void ClearEnrollmentCode(string configPath)
        {
            var lines = File.ReadAllLines(configPath, Encoding.UTF8).ToList();
            SetConfigValue(lines, "PRINT_ENROLLMENT_CODE", "");
            File.WriteAllLines(configPath, lines, new UTF8Encoding(false));
        }

        private static void ApplyRestrictedAcl(string root)
        {
            var takeown = Path.Combine(Environment.SystemDirectory, "takeown.exe");
            var ownership = RunSystemProcess(takeown, "/F " + Quote(root) + " /R /A /D Y", 60000);
            if (ownership.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu assumir controle da pasta anterior do agente. " + (ownership.Error + " " + ownership.Output).Trim());

            var icacls = Path.Combine(Environment.SystemDirectory, "icacls.exe");
            // Não usar /C: o icacls pode retornar sucesso mesmo deixando arquivos sem reparo.
            // Falhar aqui impede que o instalador continue e só descubra o problema no EXE/log.
            var reset = RunSystemProcess(icacls, Quote(root) + " /reset /T", 60000);
            if (reset.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu reparar as permissões antigas da pasta. " + (reset.Error + " " + reset.Output).Trim());

            var inheritance = RunSystemProcess(icacls, Quote(root) + " /inheritance:r /T", 60000);
            if (inheritance.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu remover permissões antigas herdadas da pasta. " + (inheritance.Error + " " + inheritance.Output).Trim());

            var arguments = Quote(root) + " /grant:r *S-1-5-18:(OI)(CI)(F) *S-1-5-32-544:(OI)(CI)(F) /T";
            var result = RunSystemProcess(icacls, arguments, 60000);
            if (result.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu proteger a pasta de configuração. " + (result.Error + " " + result.Output).Trim());

            var verify = RunSystemProcess(icacls, Quote(root) + " /verify /T", 60000);
            if (verify.ExitCode != 0)
                throw new InvalidOperationException("As permissões corrigidas ainda não passaram na verificação do Windows. " + (verify.Error + " " + verify.Output).Trim());
        }

        private static void RepairInstallFolderAcl(string root)
        {
            // Uma instalação interrompida pode deixar ProgramData acessível somente ao SYSTEM.
            // Reparar a ACL antes de abrir install.log, atualizar o EXE ou ler a configuração.
            ApplyRestrictedAcl(root);
        }

        private static bool IsAdministrator()
        {
            using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
            {
                var principal = new System.Security.Principal.WindowsPrincipal(identity);
                return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
            }
        }

        private static string ReadPrefilledEnrollmentCode()
        {
            const string resourceName = "pairing-code.txt";
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (stream == null) return String.Empty;
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    var code = reader.ReadToEnd().Trim();
                    return Regex.IsMatch(code, "^[A-Za-z0-9_-]{32}$") ? code : String.Empty;
                }
            }
        }

        private static void StopExistingAgent(string root, string agentPath)
        {
            RunSystemProcess(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), "/End /TN " + Quote(TaskName), 15000);

            var expectedPath = Path.GetFullPath(agentPath);
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(agentPath)))
            {
                using (process)
                {
                    try
                    {
                        var actualPath = process.MainModule == null ? null : process.MainModule.FileName;
                        if (String.IsNullOrWhiteSpace(actualPath) || !String.Equals(Path.GetFullPath(actualPath), expectedPath, StringComparison.OrdinalIgnoreCase)) continue;
                        process.Kill();
                        if (!process.WaitForExit(15000))
                            throw new InvalidOperationException("O agente anterior continua em execução e está impedindo a atualização. Reinicie o computador e abra o instalador como administrador.");
                    }
                    catch (System.ComponentModel.Win32Exception error)
                    {
                        throw new InvalidOperationException("O Windows não permitiu parar o processo anterior do agente. Reinicie o computador e abra o instalador como administrador.", error);
                    }
                }
            }
        }

        private static void RegisterScheduledTask(string root, string agentPath)
        {
            var xmlPath = Path.Combine(Path.GetTempPath(), "SenhaHubPrintAgentTask-" + Guid.NewGuid().ToString("N") + ".xml");
            var xml = "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
                "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">" +
                "<RegistrationInfo><Description>Agente Node SenhaHub para impressão no totem.</Description></RegistrationInfo>" +
                "<Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>" +
                "<Principals><Principal id=\"System\"><UserId>S-1-5-18</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>" +
                "<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>" +
                "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled>" +
                "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>20</Count></RestartOnFailure></Settings>" +
                "<Actions Context=\"System\"><Exec><Command>" + SecurityElementEscape(agentPath) + "</Command><WorkingDirectory>" + SecurityElementEscape(root) + "</WorkingDirectory></Exec></Actions>" +
                "</Task>";
            try
            {
                File.WriteAllText(xmlPath, xml, Encoding.Unicode);
                RunProcess(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), "/Create /TN " + Quote(TaskName) + " /XML " + Quote(xmlPath) + " /F", root, true, 30000);
            }
            finally { try { if (File.Exists(xmlPath)) File.Delete(xmlPath); } catch { } }
        }

        private static string SecurityElementEscape(string value)
        {
            return (value ?? String.Empty).Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");
        }

        private static Stream OpenAgentPayload()
        {
            var assembly = Assembly.GetExecutingAssembly();
            var name = assembly.GetManifestResourceNames().FirstOrDefault(item => item.EndsWith("SenhaHub.PrintAgent.Node.exe", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("O agente Node não foi incluído neste instalador. Baixe novamente o instalador completo.");
            return assembly.GetManifestResourceStream(name);
        }

        private static void RunProcess(string fileName, string arguments, string workingDirectory, bool failOnError, int timeoutMs)
        {
            var result = RunProcess(fileName, arguments, workingDirectory, timeoutMs);
            if (failOnError && result.ExitCode != 0)
                throw new InvalidOperationException((result.Error + " " + result.Output).Trim());
        }

        private static ProcessResult RunSystemProcess(string fileName, string arguments, int timeoutMs)
        {
            return RunProcess(fileName, arguments, Environment.SystemDirectory, timeoutMs);
        }

        private static ProcessResult RunProcess(string fileName, string arguments, string workingDirectory, int timeoutMs)
        {
            var info = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = Directory.Exists(workingDirectory) ? workingDirectory : Path.GetTempPath(),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = new Process { StartInfo = info })
            {
                var stdout = new StringBuilder();
                var stderr = new StringBuilder();
                process.OutputDataReceived += (sender, args) => { if (args.Data != null) lock (stdout) stdout.AppendLine(args.Data); };
                process.ErrorDataReceived += (sender, args) => { if (args.Data != null) lock (stderr) stderr.AppendLine(args.Data); };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("O Windows demorou demais ao executar " + Path.GetFileName(fileName) + ".");
                }
                process.WaitForExit();
                return new ProcessResult(process.ExitCode, stdout.ToString(), stderr.ToString());
            }
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? String.Empty).Replace("\"", "\\\"") + "\"";
        }

        private static string ReadTail(string path, int count)
        {
            try
            {
                if (!File.Exists(path)) return String.Empty;
                return String.Join(Environment.NewLine, File.ReadAllLines(path, Encoding.UTF8).Reverse().Take(count).Reverse());
            }
            catch (Exception error) { return "Não foi possível ler o log do agente: " + error.Message; }
        }

        private static string BuildFailureReport(Exception error, string root)
        {
            var report = new StringBuilder();
            report.AppendLine("========== FALHA COMPLETA DA INSTALAÇÃO ==========");
            report.AppendLine(error.ToString());
            report.AppendLine("Conta do instalador: " + System.Security.Principal.WindowsIdentity.GetCurrent().Name + "; administrador elevado: " + IsAdministrator());
            var icacls = Path.Combine(Environment.SystemDirectory, "icacls.exe");
            foreach (var path in new[] { root, Path.Combine(root, "SenhaHub.PrintAgent.Node.exe"), Path.Combine(root, ".env.print-agent"), Path.Combine(root, "data", "print-agent") })
            {
                if (!File.Exists(path) && !Directory.Exists(path)) continue;
                report.AppendLine("--- ACL: " + path + " ---");
                try
                {
                    var acl = RunSystemProcess(icacls, Quote(path), 10000);
                    report.AppendLine((acl.Output + Environment.NewLine + acl.Error).Trim());
                }
                catch (Exception aclError) { report.AppendLine("Não foi possível consultar a ACL: " + aclError.Message); }
            }
            var state = Path.Combine(root, "data", "print-agent");
            AppendLogSection(report, "install.log", Path.Combine(state, "install.log"));
            AppendLogSection(report, "agent-startup.log", Path.Combine(state, "agent-startup.log"));
            AppendLogSection(report, "print-agent.log", Path.Combine(state, "print-agent.log"));
            report.AppendLine("===================================================");
            return report.ToString();
        }

        private static void AppendLogSection(StringBuilder report, string title, string path)
        {
            report.AppendLine("--- " + title + " ---");
            var content = ReadTail(path, 50);
            report.AppendLine(String.IsNullOrWhiteSpace(content) ? "(arquivo ausente ou vazio)" : content);
        }

        private void LogTo(string path, string message)
        {
            WriteLog(message);
            try
            {
                var directory = Path.GetDirectoryName(path);
                if (!String.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                File.AppendAllText(path, DateTime.Now.ToString("o") + " " + message + Environment.NewLine, new UTF8Encoding(false));
            }
            catch (Exception error)
            {
                WriteLog("Aviso: não foi possível gravar install.log: " + error.Message);
            }
        }

        private void WriteLog(string message)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(WriteLog), message); return; }
            log.AppendText(DateTime.Now.ToString("HH:mm:ss") + " " + message + Environment.NewLine);
        }

        private void AppendOutput(string message)
        {
            if (String.IsNullOrWhiteSpace(message)) return;
            if (InvokeRequired) { BeginInvoke(new Action<string>(AppendOutput), message); return; }
            log.AppendText(message + Environment.NewLine);
            log.SelectionStart = log.TextLength;
            log.ScrollToCaret();
        }

        private void SetStatus(string message, bool error)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string, bool>(SetStatus), message, error); return; }
            status.Text = message;
            status.ForeColor = error ? Color.Firebrick : Color.DarkGreen;
        }

        private void SetBusy(bool busy)
        {
            installButton.Enabled = !busy;
            diagnoseButton.Enabled = !busy;
            refreshButton.Enabled = !busy;
            apiUrl.Enabled = !busy;
            enrollmentCode.Enabled = !busy;
            printerPort.Enabled = !busy;
            if (busy) SetStatus("Instalando... aguarde a conclusão.", false);
        }

        private sealed class ProcessResult
        {
            public readonly int ExitCode;
            public readonly string Output;
            public readonly string Error;
            public ProcessResult(int exitCode, string output, string error) { ExitCode = exitCode; Output = output; Error = error; }
        }
    }
}
