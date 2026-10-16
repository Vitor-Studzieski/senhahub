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
        private readonly Button testPrintButton = new Button();
        private readonly Button printerDiagButton = new Button();
        private readonly Button refreshButton = new Button();
        private readonly Label testHint = new Label();
        private bool agentReady;

        public InstallerForm()
        {
            Text = "Instalador do agente Node — SenhaHub";
            ClientSize = new Size(700, 530);
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

            AddLabel("Código temporário de pareamento (obrigatório, válido por 30 minutos)", 24, 128);
            enrollmentCode.SetBounds(24, 151, 652, 27);
            enrollmentCode.UseSystemPasswordChar = true;
            var prefilledCode = ReadPrefilledEnrollmentCode();
            enrollmentCode.Text = prefilledCode;
            Controls.Add(enrollmentCode);
            var revealCode = new CheckBox { Text = "Mostrar código", AutoSize = true };
            revealCode.SetBounds(24, 183, 150, 22);
            revealCode.CheckedChanged += delegate { enrollmentCode.UseSystemPasswordChar = !revealCode.Checked; };
            Controls.Add(revealCode);
            var hint = new Label
            {
                Text = String.IsNullOrWhiteSpace(prefilledCode)
                    ? "A instalação limpa apaga a sessão anterior. Gere um código no console e cole acima."
                    : "Código temporário já preenchido neste instalador. Ele não aparece nos registros.",
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

            testPrintButton.Text = "Testar impressão";
            testPrintButton.SetBounds(24, 338, 190, 36);
            testPrintButton.Enabled = false;
            testPrintButton.Click += async delegate { await TestPrinterAsync(); };
            Controls.Add(testPrintButton);

            testHint.Text = "Disponível após validar instalação, pareamento e tarefa automática.";
            testHint.AutoSize = true;
            testHint.ForeColor = Color.DimGray;
            testHint.SetBounds(226, 346, 205, 32);
            Controls.Add(testHint);

            printerDiagButton.Text = "Diagnóstico USB / driver";
            printerDiagButton.SetBounds(441, 338, 235, 36);
            printerDiagButton.Click += async delegate { await DiagnoseBematechAsync(); };
            Controls.Add(printerDiagButton);

            status.AutoSize = false;
            status.SetBounds(444, 286, 232, 42);
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.ForeColor = Color.DimGray;
            Controls.Add(status);

            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.Font = new Font("Consolas", 9);
            log.SetBounds(24, 388, 652, 118);
            Controls.Add(log);

            Load += async delegate { LoadPorts(); await RefreshAgentReadyStateAsync(); };
            WriteLog("Este instalador inclui o agente Node e não precisa de PowerShell, Node.js ou código-fonte.");
            WriteLog("A instalação limpa apaga os arquivos antigos, inclusive sessão, journal, configuração e logs.");
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
            var com3Detected = ports.Any(port => String.Equals(port, "COM3", StringComparison.OrdinalIgnoreCase));
            if (!com3Detected) printerPort.Items.Add("COM3"); // Mantém seleção manual sem trocar para uma COM errada.

            if (!String.IsNullOrWhiteSpace(selected) && printerPort.Items.Contains(selected)) printerPort.SelectedItem = selected;
            else if (printerPort.Items.Contains("COM3")) printerPort.SelectedItem = "COM3";
            else if (printerPort.Items.Count > 0) printerPort.SelectedIndex = 0;

            WriteLog("Portas enumeradas: " + String.Join(", ", ports.Length == 0 ? new[] { "nenhuma" } : ports));
            if (!com3Detected)
                SetStatus("COM3 não foi detectada. Confirme o cabo e o driver no Gerenciador de Dispositivos antes de testar a impressão.", true);
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
            if (String.IsNullOrWhiteSpace(code))
            {
                SetStatus("A instalação limpa exige um código de pareamento novo.", true);
                return;
            }
            if (String.IsNullOrWhiteSpace(port) || !Regex.IsMatch(port, "^COM[0-9]+$", RegexOptions.IgnoreCase))
            {
                SetStatus("Selecione uma porta no formato COM3.", true);
                return;
            }

            agentReady = false;
            testPrintButton.Enabled = false;
            testHint.Text = "Teste bloqueado durante a instalação.";
            SetBusy(true);
            try
            {
                await Task.Run(() => InstallAgent(url, code, port));
                await RefreshAgentReadyStateAsync();
                if (agentReady)
                    SetStatus("Instalação e pareamento validados. O teste de impressão está disponível.", false);
                else
                    SetStatus("O agente foi copiado, mas a validação final falhou. O teste de impressão permanece bloqueado.", true);
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
                await RefreshAgentReadyStateAsync();
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

        private async Task DiagnoseBematechAsync()
        {
            SetBusy(true);
            try
            {
                SetStatus("Consultando o driver e a enumeração USB...", false);
                var report = await Task.Run(GetBematechDiagnosticReport);
                AppendOutput(report);
                var ports = SerialPort.GetPortNames();
                var found = ports.Any(port => String.Equals(port, "COM3", StringComparison.OrdinalIgnoreCase));
                SetStatus(found ? "Diagnóstico concluído. COM3 está disponível." : "Diagnóstico concluído. COM3 ainda não está disponível; veja os detalhes abaixo.", !found);
            }
            catch (Exception error)
            {
                SetStatus("Falha no diagnóstico USB: " + error.Message, true);
                AppendOutput("ERRO NO DIAGNÓSTICO USB / DRIVER" + Environment.NewLine + error);
            }
            finally { SetBusy(false); }
        }

        private async Task TestPrinterAsync()
        {
            await RefreshAgentReadyStateAsync();
            if (!agentReady)
            {
                SetStatus("O teste está bloqueado: instalação, pareamento ou tarefa automática não foram validados.", true);
                return;
            }

            var confirmation = MessageBox.Show(this,
                "Este teste vai imprimir um cupom físico na Bematech e pausar o agente por alguns segundos. " +
                "Confirme que não há uma impressão em andamento e que você pode recolher o cupom.\r\n\r\nDeseja continuar?",
                "Confirmar impressão de teste", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (confirmation != DialogResult.Yes) return;

            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
            var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
            var taskDisabled = false;
            SetBusy(true);
            try
            {
                SetStatus("Pausando o agente para o teste...", false);
                await Task.Run(() => DisableScheduledTaskForTest(root));
                taskDisabled = true;
                await Task.Run(() => StopExistingAgent(root, agentPath, false));

                SetStatus("Enviando cupom de teste para a impressora...", false);
                var result = await Task.Run(() => RunProcess(agentPath, "--test-printer", root, 90000));
                AppendOutput("TESTE DE IMPRESSÃO" + Environment.NewLine + result.Output);
                if (!String.IsNullOrWhiteSpace(result.Error)) AppendOutput(result.Error);
                if (result.ExitCode != 0)
                    throw new InvalidOperationException("O agente não conseguiu enviar o cupom de teste. Confira porta, cabo, driver e log do agente.");

                SetStatus("Cupom enviado. Confirme se saiu papel na Bematech.", false);
            }
            catch (Exception error)
            {
                AppendOutput("ERRO NO TESTE DE IMPRESSÃO" + Environment.NewLine + error);
                SetStatus("Falha no teste de impressão: " + error.Message, true);
            }
            finally
            {
                if (taskDisabled)
                {
                    try
                    {
                        await Task.Run(() => ResumeScheduledTaskAfterTest(root));
                        WriteLog("Agente retomado após o teste de impressão.");
                    }
                    catch (Exception resumeError)
                    {
                        AppendOutput("ATENÇÃO: não foi possível retomar o agente automaticamente." + Environment.NewLine + resumeError);
                        SetStatus("Não foi possível retomar o agente. Use Diagnosticar e confira a tarefa.", true);
                    }
                }
                SetBusy(false);
            }
        }

        private static string GetBematechDiagnosticReport()
        {
            var report = new StringBuilder();
            report.AppendLine("========== DIAGNÓSTICO BEMATECH MP-4200 TH ==========");
            report.AppendLine("Windows x64: " + Environment.Is64BitOperatingSystem);
            report.AppendLine("Processo instalador x64: " + Environment.Is64BitProcess);
            report.AppendLine("Versão informada pelo Windows: " + Environment.OSVersion);
            var ports = SerialPort.GetPortNames().OrderBy(port => port).ToArray();
            report.AppendLine("Portas seriais: " + (ports.Length == 0 ? "nenhuma enumerada" : String.Join(", ", ports)));

            var pnputil = Path.Combine(Environment.SystemDirectory, "pnputil.exe");
            var inventory = RunSystemProcess(pnputil, "/enum-drivers", 30000);
            report.AppendLine("Pacotes Bematech USB/COM no Driver Store:");
            var packages = FindBematechUsbComPackages();
            report.AppendLine(packages.Count == 0
                ? "nenhum INF publicado do driver Bematech USB/COM encontrado em Windows\\INF"
                : String.Join(", ", packages));
            if (inventory.ExitCode != 0)
            {
                report.AppendLine("pnputil /enum-drivers terminou com código " + inventory.ExitCode + ".");
                AppendProcessText(report, inventory);
            }

            report.AppendLine("Dispositivo USB VID_0B1B / PID_0003 (MP-4200 TH):");
            var device = RunSystemProcess(pnputil,
                "/enum-devices /deviceid " + Quote("USB\\VID_0B1B&PID_0003") + " /drivers /properties", 30000);
            if (device.ExitCode != 0)
                report.AppendLine("pnputil /enum-devices terminou com código " + device.ExitCode + ".");
            AppendProcessText(report, device);
            report.AppendLine("=====================================================");
            return report.ToString();
        }

        private void InstallBematechUsbComDriver(Action<string> log)
        {
            var pnputil = Path.Combine(Environment.SystemDirectory, "pnputil.exe");
            var tempDirectory = Path.Combine(Path.GetTempPath(), "SenhaHub.BematechUsbCom." + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            try
            {
                var infPath = Path.Combine(tempDirectory, "bematech-usbcom.inf");
                ExtractDriverResource("bematech-usbcom.inf", Path.Combine(tempDirectory, "bematech-usbcom.inf"));
                ExtractDriverResource("bematech-usbcom.cat", Path.Combine(tempDirectory, "bematech-usbcom.cat"));
                ExtractDriverResource("bematech-usbcom.sys", Path.Combine(tempDirectory, "bematech-usbcom.sys"));

                log("Preparando driver USB/serial Bematech x64 (INF 4.0.2.32103; MP-4200 TH VID_0B1B&PID_0003)...");
                var staged = RunSystemProcess(pnputil, "/add-driver " + Quote(infPath), 120000);
                var stagedText = CombineProcessText(staged);
                log("Resultado do armazenamento do driver: " + stagedText.Trim());
                if (staged.ExitCode != 0)
                    throw new InvalidOperationException("O Windows recusou o pacote x64 Bematech ao validar/armazenar o driver. Código " + staged.ExitCode + ". " + stagedText.Trim());

                var oldPackages = FindBematechUsbComPackages();
                var stagedPackage = FindPublishedDriverPackage(stagedText);
                if (String.IsNullOrWhiteSpace(stagedPackage))
                    stagedPackage = FindPublishedDriverPackageByVersion(infPath, oldPackages);
                if (!String.IsNullOrWhiteSpace(stagedPackage))
                    log("Pacote Bematech validado nesta execução: " + stagedPackage + ".");
                var canSafelyRemoveOldPackages = !String.IsNullOrWhiteSpace(stagedPackage);
                if (!canSafelyRemoveOldPackages && oldPackages.Count > 0)
                    log("O PnPUtil não informou o nome publicado do pacote recém-validado; por segurança, os pacotes existentes não serão removidos nesta execução.");
                foreach (var package in oldPackages)
                {
                    if (!canSafelyRemoveOldPackages) break;
                    if (String.Equals(package, stagedPackage, StringComparison.OrdinalIgnoreCase))
                    {
                        log("Mantendo o pacote Bematech x64 validado nesta execução: " + package + ".");
                        continue;
                    }
                    log("Removendo pacote Bematech MP-4200 USB/COM antigo " + package + "...");
                    var removal = RunSystemProcess(pnputil, "/delete-driver " + Quote(package) + " /uninstall /force", 120000);
                    var removalText = CombineProcessText(removal);
                    log("Resultado da remoção " + package + ": " + removalText.Trim());
                    if (removal.ExitCode != 0)
                        throw new InvalidOperationException("O Windows não conseguiu remover o pacote Bematech antigo " + package + ". Código " + removal.ExitCode + ". " + removalText.Trim());
                }
                if (oldPackages.Count == 0) log("Nenhum pacote antigo bematech-usbcom.inf encontrado para remover.");

                var install = RunSystemProcess(pnputil, "/add-driver " + Quote(infPath) + " /install", 120000);
                var installText = CombineProcessText(install);
                log("Resultado da instalação do driver: " + installText.Trim());
                if (install.ExitCode != 0)
                    throw new InvalidOperationException("O Windows não conseguiu instalar o driver Bematech USB/serial x64. Código " + install.ExitCode + ". " + installText.Trim());

                var scan = RunSystemProcess(pnputil, "/scan-devices", 60000);
                log("Nova varredura de dispositivos: " + CombineProcessText(scan).Trim());
                if (scan.ExitCode != 0)
                    log("Aviso: o Windows retornou código " + scan.ExitCode + " na varredura; consulte Diagnóstico USB / driver.");

                var after = RunSystemProcess(pnputil, "/enum-drivers", 30000);
                if (after.ExitCode != 0)
                    log("Aviso: pnputil /enum-drivers retornou código " + after.ExitCode + " após a instalação; a inclusão e instalação do pacote já foram confirmadas pelo código de saída do pnputil /add-driver.");
                var installedPackages = FindBematechUsbComPackages();
                var stagedInfPath = String.IsNullOrWhiteSpace(stagedPackage)
                    ? String.Empty
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "INF", stagedPackage);
                if ((!String.IsNullOrWhiteSpace(stagedPackage) && File.Exists(stagedInfPath)) || installedPackages.Count > 0)
                    log("Driver Bematech USB/serial x64 confirmado no Driver Store: " + (installedPackages.Count > 0 ? String.Join(", ", installedPackages) : stagedPackage) + ".");
                else
                    log("Aviso: o PnPUtil aceitou a inclusão e instalação do driver, mas não foi possível enumerar os INF publicados em Windows\\INF.");
            }
            finally
            {
                try { if (Directory.Exists(tempDirectory)) Directory.Delete(tempDirectory, true); } catch { }
            }
        }

        private static void ExtractDriverResource(string resourceName, string destination)
        {
            using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (source == null)
                    throw new InvalidOperationException("O driver " + resourceName + " não está incluído neste instalador.");
                using (var target = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    source.CopyTo(target);
            }
        }

        private static List<string> FindBematechUsbComPackages()
        {
            var packages = new List<string>();
            var infDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "INF");
            if (!Directory.Exists(infDirectory)) return packages;

            string[] publishedInfs;
            try { publishedInfs = Directory.GetFiles(infDirectory, "oem*.inf", SearchOption.TopDirectoryOnly); }
            catch { return packages; }

            foreach (var path in publishedInfs)
            {
                string contents;
                try { contents = File.ReadAllText(path, Encoding.Default); }
                catch { continue; }
                if (!Regex.IsMatch(contents, @"(?im)^\s*ClassGuid\s*=\s*\{4d36e978-e325-11ce-bfc1-08002be10318\}\s*$")) continue;
                if (contents.IndexOf("USB\\VID_0B1B&PID_0003", StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (contents.IndexOf("AddService = bematech-usbcom,", StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (contents.IndexOf("S_Provider = \"Bematech\"", StringComparison.OrdinalIgnoreCase) < 0) continue;
                var name = Path.GetFileName(path);
                if (!packages.Contains(name, StringComparer.OrdinalIgnoreCase)) packages.Add(name);
            }
            return packages;
        }

        private static string FindPublishedDriverPackage(string output)
        {
            // Some PnPUtil versions emit UTF-16-like output even when redirected. The UI
            // drops the NULs when rendering the log, but they prevent the regex from matching.
            var normalized = (output ?? String.Empty).Replace("\0", String.Empty);
            var match = Regex.Match(normalized, @"(?i)oem[0-9]+\.inf");
            return match.Success ? match.Value : String.Empty;
        }

        private static string FindPublishedDriverPackageByVersion(string sourceInfPath, IEnumerable<string> candidates)
        {
            var sourceVersion = ReadInfDriverVersion(sourceInfPath);
            if (String.IsNullOrWhiteSpace(sourceVersion)) return String.Empty;

            var infDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "INF");
            foreach (var candidate in candidates ?? Enumerable.Empty<string>())
            {
                var publishedInfPath = Path.Combine(infDirectory, candidate);
                if (String.Equals(sourceVersion, ReadInfDriverVersion(publishedInfPath), StringComparison.OrdinalIgnoreCase))
                    return candidate;
            }
            return String.Empty;
        }

        private static string ReadInfDriverVersion(string infPath)
        {
            try
            {
                var contents = File.ReadAllText(infPath, Encoding.Default).Replace("\0", String.Empty);
                var match = Regex.Match(contents, @"(?im)^\s*DriverVer\s*=\s*[^,\r\n]+,\s*([^;\s\r\n]+)");
                return match.Success ? match.Groups[1].Value.Trim() : String.Empty;
            }
            catch { return String.Empty; }
        }

        private static string CombineProcessText(ProcessResult result)
        {
            return (result.Output ?? String.Empty) + Environment.NewLine + (result.Error ?? String.Empty);
        }

        private static void AppendProcessText(StringBuilder report, ProcessResult result)
        {
            var output = (result.Output ?? String.Empty).Trim();
            var error = (result.Error ?? String.Empty).Trim();
            if (output.Length > 0) report.AppendLine(output);
            if (error.Length > 0) report.AppendLine(error);
            if (output.Length == 0 && error.Length == 0) report.AppendLine("(o Windows não retornou detalhes)");
        }

        private async Task RefreshAgentReadyStateAsync()
        {
            agentReady = false;
            testPrintButton.Enabled = false;
            testHint.Text = "Verificando instalação e pareamento...";
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
            try { agentReady = await Task.Run(() => IsAgentInstalledCorrectly(root)); }
            catch (Exception error) { WriteLog("Validação do agente falhou: " + error.Message); }
            testPrintButton.Enabled = agentReady && installButton.Enabled;
            testHint.Text = agentReady
                ? "Imprime um cupom físico e pausa o agente por alguns segundos."
                : "Teste bloqueado até validar instalação, pareamento e tarefa automática.";
        }

        private static bool IsAgentInstalledCorrectly(string root)
        {
            var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
            var configPath = Path.Combine(root, ".env.print-agent");
            var installMarker = Path.Combine(root, "installation.ok");
            if (!File.Exists(agentPath) || !File.Exists(configPath)) return false;

            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in File.ReadAllLines(configPath, Encoding.UTF8))
            {
                var separator = line.IndexOf('=');
                if (separator <= 0) continue;
                values[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
            }

            string apiUrl, port, statePath, enrollmentCode;
            if (!values.TryGetValue("PRINT_API_URL", out apiUrl) ||
                !Uri.TryCreate(apiUrl, UriKind.Absolute, out var parsedUrl) || parsedUrl.Scheme != Uri.UriSchemeHttps ||
                !values.TryGetValue("KIOSK_PRINTER_PORT", out port) || !Regex.IsMatch(port, "^COM[0-9]+$", RegexOptions.IgnoreCase) ||
                !values.TryGetValue("PRINT_AGENT_STATE_DIR", out statePath) || String.IsNullOrWhiteSpace(statePath) ||
                !values.TryGetValue("PRINT_ENROLLMENT_CODE", out enrollmentCode) || !String.IsNullOrWhiteSpace(enrollmentCode)) return false;

            var stateDb = Path.Combine(statePath, "agent-v2.sqlite");
            var agentLog = Path.Combine(statePath, "print-agent.log");
            if (!File.Exists(stateDb) || new FileInfo(stateDb).Length == 0 || !File.Exists(agentLog)) return false;
            var hasInstallMarker = File.Exists(installMarker);
            if (hasInstallMarker && !File.ReadAllText(installMarker, Encoding.UTF8).StartsWith("SenhaHub Print Agent Node v2; bootstrap=ok", StringComparison.Ordinal)) return false;
            if (!hasInstallMarker)
            {
                var bootLogged = File.ReadAllText(agentLog, Encoding.UTF8).Contains("INFO Agente v2 iniciado.");
                var previousLog = Path.Combine(statePath, "print-agent.log.1");
                if (!bootLogged && File.Exists(previousLog)) bootLogged = File.ReadAllText(previousLog, Encoding.UTF8).Contains("INFO Agente v2 iniciado.");
                if (!bootLogged) return false;
            }

            var scheduler = Path.Combine(Environment.SystemDirectory, "schtasks.exe");
            var task = RunSystemProcess(scheduler, "/Query /TN " + Quote(TaskName) + " /XML", 15000);
            if (task.ExitCode != 0) return false;
            var taskXml = (task.Output ?? String.Empty).Replace("\0", String.Empty);
            return Regex.IsMatch(taskXml, "<Enabled>\\s*true\\s*</Enabled>", RegexOptions.IgnoreCase) &&
                taskXml.IndexOf("<Command>" + SecurityElementEscape(agentPath) + "</Command>", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void DisableScheduledTaskForTest(string root)
        {
            var scheduler = Path.Combine(Environment.SystemDirectory, "schtasks.exe");
            var query = RunSystemProcess(scheduler, "/Query /TN " + Quote(TaskName), 15000);
            if (query.ExitCode != 0)
                throw new InvalidOperationException("A tarefa automática do agente não foi encontrada. Reinstale o agente antes de testar a impressão.");
            var disabled = RunSystemProcess(scheduler, "/Change /TN " + Quote(TaskName) + " /Disable", 15000);
            if (disabled.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu pausar a tarefa do agente. " + (disabled.Error + " " + disabled.Output).Trim());
        }

        private static void ResumeScheduledTaskAfterTest(string root)
        {
            var scheduler = Path.Combine(Environment.SystemDirectory, "schtasks.exe");
            var enabled = RunSystemProcess(scheduler, "/Change /TN " + Quote(TaskName) + " /Enable", 15000);
            if (enabled.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu reativar a tarefa do agente. " + (enabled.Error + " " + enabled.Output).Trim());
            RunProcess(scheduler, "/Run /TN " + Quote(TaskName), root, true, 30000);
        }

        private void InstallAgent(string url, string code, string port)
        {
            if (String.IsNullOrWhiteSpace(code))
                throw new InvalidOperationException("A instalação limpa precisa de um código novo. Gere no console, cole no campo do instalador e tente novamente.");
            if (!IsAdministrator())
                throw new InvalidOperationException("O instalador não está elevado como administrador. Feche esta janela e abra o .exe com o botão direito > Executar como administrador.");
            using (OpenAgentPayload()) { }

            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgent");
            var state = Path.Combine(root, "data", "print-agent");
            var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Node.exe");
            var configPath = Path.Combine(root, ".env.print-agent");
            var logPath = Path.Combine(state, "install.log");
            // Stop the previous agent before repairing permissions and deleting its installation.
            StopExistingAgent(root, agentPath, false);
            InstallBematechUsbComDriver(WriteLog);
            // Remove the old boot task only after the bundled driver has been staged successfully.
            StopExistingAgent(root, agentPath);
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
            DeleteInstallationContents(root);
            Directory.CreateDirectory(state);

            LogTo(logPath, "Preparando instalação em " + root + ".");
            LogTo(logPath, "Driver USB/serial x64 Bematech instalado ou atualizado pelo pacote incluso.");
            using (var source = OpenAgentPayload())
            using (var target = new FileStream(agentPath, FileMode.Create, FileAccess.Write, FileShare.None)) source.CopyTo(target);

            var lines = new List<string>();
            SetConfigValue(lines, "PRINT_API_URL", url);
            SetConfigValue(lines, "KIOSK_PRINTER_PORT", port.ToUpperInvariant());
            SetConfigValue(lines, "PRINT_SERIAL_BAUD_RATE", "115200");
            SetConfigValue(lines, "PRINT_SERIAL_DATA_BITS", "8");
            SetConfigValue(lines, "PRINT_SERIAL_STOP_BITS", "1");
            SetConfigValue(lines, "PRINT_SERIAL_PARITY", "none");
            SetConfigValue(lines, "PRINT_SERIAL_RTSCTS", "0");
            SetConfigValue(lines, "PRINT_AGENT_STATE_DIR", state);
            SetConfigValue(lines, "PRINT_ENROLLMENT_CODE", code);
            LogTo(logPath, "Código temporário recebido. O valor não é gravado no registro.");
            SetConfigValue(lines, "PRINT_REALTIME_ENABLED", "1");
            File.WriteAllLines(configPath, lines, new UTF8Encoding(false));
            ProtectRuntimeAcl(configPath, state);

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
                        ClearEnrollmentCode(configPath);
                        File.WriteAllText(Path.Combine(root, "installation.ok"),
                            "SenhaHub Print Agent Node v2; bootstrap=ok; " + DateTime.UtcNow.ToString("o"), new UTF8Encoding(false));
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

        private static void DeleteInstallationContents(string root)
        {
            foreach (var path in Directory.GetFileSystemEntries(root)) DeleteInstallationEntry(path);
        }

        private static void DeleteInstallationEntry(string path)
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.Directory) != 0)
            {
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    Directory.Delete(path, false);
                    return;
                }
                foreach (var child in Directory.GetFileSystemEntries(path)) DeleteInstallationEntry(child);
                File.SetAttributes(path, attributes & ~(FileAttributes.ReadOnly | FileAttributes.Hidden | FileAttributes.System));
                Directory.Delete(path, false);
                return;
            }

            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                File.Delete(path);
                return;
            }
            File.SetAttributes(path, FileAttributes.Normal);
            File.Delete(path);
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

            var acl = Quote(root) + " /grant:r *S-1-5-18:(OI)(CI)(F) *S-1-5-32-544:(OI)(CI)(F) /T";
            var grantBeforeInheritance = RunSystemProcess(icacls, acl, 60000);
            if (grantBeforeInheritance.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu conceder acesso de reparo ao SYSTEM e aos administradores. " + (grantBeforeInheritance.Error + " " + grantBeforeInheritance.Output).Trim());

            var inheritance = RunSystemProcess(icacls, Quote(root) + " /inheritance:r /T", 60000);
            if (inheritance.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu remover permissões antigas herdadas da pasta. " + (inheritance.Error + " " + inheritance.Output).Trim());

            // Apply an explicit ACE to every existing object. In particular, old installs can
            // leave individual files with an empty or protected DACL even after the directory
            // ACL looks correct. Inheritable-only grants are not enough for those files.
            var directAcl = Quote(root) + " /grant:r *S-1-5-18:F *S-1-5-32-544:F /T";
            var result = RunSystemProcess(icacls, directAcl, 60000);
            if (result.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu conceder acesso aos arquivos da instalação. " + (result.Error + " " + result.Output).Trim());

            // Keep newly created state, log, and SQLite files restricted to SYSTEM/admins too.
            // The direct recursive grant above repairs existing files; these directory ACEs
            // propagate the same access to files created during normal operation.
            var directories = new List<string> { root };
            for (var index = 0; index < directories.Count; index++)
            {
                foreach (var child in Directory.GetDirectories(directories[index]))
                {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) directories.Add(child);
                }
            }
            foreach (var directory in directories)
            {
                var inheritedAcl = Quote(directory) + " /grant:r *S-1-5-18:(OI)(CI)(F) *S-1-5-32-544:(OI)(CI)(F)";
                var inherited = RunSystemProcess(icacls, inheritedAcl, 60000);
                if (inherited.ExitCode != 0)
                    throw new InvalidOperationException("O Windows não conseguiu proteger arquivos futuros em " + directory + ". " + (inherited.Error + " " + inherited.Output).Trim());
            }

            var verify = RunSystemProcess(icacls, Quote(root) + " /verify /T", 60000);
            if (verify.ExitCode != 0)
                throw new InvalidOperationException("As permissões corrigidas ainda não passaram na verificação do Windows. " + (verify.Error + " " + verify.Output).Trim());
        }

        private static void RepairInstallFolderAcl(string root)
        {
            // Uma instalação interrompida pode deixar ProgramData acessível somente ao SYSTEM.
            // Reparar a ACL antes de limpar arquivos antigos e gravar a instalação nova.
            ApplyRestrictedAcl(root);
        }

        private static void ProtectRuntimeAcl(string configPath, string stateDirectory)
        {
            var icacls = Path.Combine(Environment.SystemDirectory, "icacls.exe");
            var configAcl = RunSystemProcess(icacls,
                Quote(configPath) + " /inheritance:r /grant:r *S-1-5-18:R *S-1-5-32-544:F", 30000);
            if (configAcl.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu restringir a configuração do agente ao SYSTEM e administradores. " + (configAcl.Error + " " + configAcl.Output).Trim());

            var stateAcl = RunSystemProcess(icacls,
                Quote(stateDirectory) + " /inheritance:r /grant:r *S-1-5-18:(OI)(CI)(F) *S-1-5-32-544:(OI)(CI)(F)", 30000);
            if (stateAcl.ExitCode != 0)
                throw new InvalidOperationException("O Windows não conseguiu restringir o journal do agente ao SYSTEM e administradores. " + (stateAcl.Error + " " + stateAcl.Output).Trim());
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

        private static void StopExistingAgent(string root, string agentPath, bool removeTask = true)
        {
            var scheduler = Path.Combine(Environment.SystemDirectory, "schtasks.exe");
            RunSystemProcess(scheduler, "/End /TN " + Quote(TaskName), 15000);

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
                            throw new InvalidOperationException("O agente anterior continua em execução e está impedindo a instalação limpa. Reinicie o computador e abra o instalador como administrador.");
                    }
                    catch (System.ComponentModel.Win32Exception error)
                    {
                        throw new InvalidOperationException("O Windows não permitiu parar o processo anterior do agente. Reinicie o computador e abra o instalador como administrador.", error);
                    }
                }
            }

            if (removeTask)
            {
                // Prevent the old boot task from restarting while its files are being removed.
                RunSystemProcess(scheduler, "/Delete /TN " + Quote(TaskName) + " /F", 15000);
            }
        }

        private static void RegisterScheduledTask(string root, string agentPath)
        {
            var xmlPath = Path.Combine(Path.GetTempPath(), "SenhaHubPrintAgentTask-" + Guid.NewGuid().ToString("N") + ".xml");
            var xml = "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
                "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">" +
                "<RegistrationInfo><Description>Agente Node SenhaHub para impressão no totem.</Description></RegistrationInfo>" +
                "<Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>" +
                "<Principals><Principal id=\"System\"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>" +
                "<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>" +
                "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled>" +
                "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>20</Count></RestartOnFailure></Settings>" +
                "<Actions Context=\"System\"><Exec><Command>" + SecurityElementEscape(agentPath) + "</Command><WorkingDirectory>" + SecurityElementEscape(root) + "</WorkingDirectory></Exec></Actions>" +
                "</Task>";
            try
            {
                File.WriteAllText(xmlPath, xml, Encoding.Unicode);
                RunProcess(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), "/Create /TN " + Quote(TaskName) + " /XML " + Quote(xmlPath) + " /RU SYSTEM /F", root, true, 30000);
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
            printerDiagButton.Enabled = !busy;
            testPrintButton.Enabled = !busy && agentReady;
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
