using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Reflection;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace SenhaHub.PrintAgent.Setup
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs error)
            {
                MessageBox.Show(error.Exception.Message, "Falha no instalador", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            Application.Run(new InstallerForm());
        }
    }

    internal sealed class InstallerForm : Form
    {
        private const string ServiceName = "SenhaHubPrintAgentX86";
        private const string ServiceDisplayName = "SenhaHub Print Agent x86";
        private readonly TextBox apiUrl = new TextBox();
        private readonly TextBox enrollmentCode = new TextBox();
        private readonly ComboBox printerPort = new ComboBox();
        private readonly Label status = new Label();
        private readonly TextBox log = new TextBox();
        private readonly Button testButton = new Button();
        private readonly Button installButton = new Button();

        public InstallerForm()
        {
            Text = "Instalação do agente de impressão SenhaHub";
            ClientSize = new Size(620, 430);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            AddLabel("Servidor do SenhaHub", 20, 20);
            apiUrl.SetBounds(20, 42, 575, 25);
            apiUrl.Text = "https://senhahub.vercel.app";
            Controls.Add(apiUrl);

            AddLabel("Código de pareamento", 20, 78);
            enrollmentCode.SetBounds(20, 100, 575, 25);
            Controls.Add(enrollmentCode);

            AddLabel("Porta da Bematech", 20, 136);
            printerPort.SetBounds(20, 158, 150, 25);
            printerPort.DropDownStyle = ComboBoxStyle.DropDown;
            Controls.Add(printerPort);

            var refreshButton = new Button { Text = "Atualizar portas" };
            refreshButton.SetBounds(180, 157, 120, 27);
            refreshButton.Click += delegate { LoadPorts(); };
            Controls.Add(refreshButton);

            status.AutoSize = false;
            status.SetBounds(20, 195, 575, 30);
            status.ForeColor = Color.DimGray;
            Controls.Add(status);

            testButton.Text = "Testar impressora";
            testButton.SetBounds(20, 235, 150, 32);
            testButton.Click += delegate { TestPrinter(); };
            Controls.Add(testButton);

            installButton.Text = "Instalar e iniciar agente";
            installButton.SetBounds(180, 235, 190, 32);
            installButton.Click += delegate { InstallAgent(); };
            Controls.Add(installButton);

            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.SetBounds(20, 285, 575, 120);
            Controls.Add(log);

            Load += delegate { LoadPorts(); };
        }

        private void AddLabel(string text, int x, int y)
        {
            var label = new Label { Text = text, AutoSize = true };
            label.SetBounds(x, y, 300, 20);
            Controls.Add(label);
        }

        private void LoadPorts()
        {
            var selected = printerPort.Text;
            printerPort.Items.Clear();
            foreach (var port in SerialPort.GetPortNames().OrderBy(p => p)) printerPort.Items.Add(port);
            if (printerPort.Items.Count == 0) printerPort.Text = string.IsNullOrWhiteSpace(selected) ? "COM4" : selected;
            else if (printerPort.Items.Contains(selected)) printerPort.SelectedItem = selected;
            else if (printerPort.Items.Contains("COM4")) printerPort.SelectedItem = "COM4";
            else printerPort.SelectedIndex = 0;
            WriteLog("Portas encontradas: " + (printerPort.Items.Count == 0 ? "nenhuma" : string.Join(", ", printerPort.Items.Cast<object>())));
        }

        private void TestPrinter()
        {
            var port = printerPort.Text.Trim();
            if (port.Length == 0)
            {
                SetStatus("Informe a porta da impressora.", true);
                return;
            }

            try
            {
                SetBusy(true);
                using (var serial = new SerialPort(port, 115200, Parity.None, 8, StopBits.One))
                {
                    serial.Handshake = Handshake.None;
                    serial.DtrEnable = false;
                    serial.RtsEnable = false;
                    serial.Open();
                    var bytes = Encoding.ASCII.GetBytes("\x1B@\x1Ba\x01SenhaHub\r\nTeste de comunicacao\r\n\r\n");
                    serial.Write(bytes, 0, bytes.Length);
                    serial.BaseStream.Flush();
                }
                SetStatus("Teste enviado. Confira a impressão.", false);
                WriteLog("Teste enviado para " + port + ".");
            }
            catch (Exception error)
            {
                SetStatus("Não foi possível abrir a porta: " + error.Message, true);
                WriteLog("Falha no teste: " + error);
            }
            finally
            {
                SetBusy(false);
            }
        }

        private void InstallAgent()
        {
            var url = apiUrl.Text.Trim().TrimEnd('/');
            var code = enrollmentCode.Text.Trim();
            var port = printerPort.Text.Trim();
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                SetStatus("O servidor precisa usar HTTPS.", true);
                return;
            }
            if (code.Length == 0)
            {
                SetStatus("Informe o código de pareamento.", true);
                return;
            }
            if (port.Length == 0)
            {
                SetStatus("Informe a porta da impressora.", true);
                return;
            }

            try
            {
                SetBusy(true);
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgentX86");
                var state = Path.Combine(root, "data", "print-agent-x86");
                Directory.CreateDirectory(root);
                Directory.CreateDirectory(state);
                var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.X86.exe");
                using (var source = OpenAgentPayload())
                using (var target = File.Create(agentPath)) source.CopyTo(target);

                var env = new StringBuilder()
                    .AppendLine("PRINT_API_URL=" + url)
                    .AppendLine("PRINT_ENROLLMENT_CODE=" + code)
                    .AppendLine("KIOSK_PRINTER_PORT=" + port)
                    .AppendLine("PRINT_SERIAL_BAUD_RATE=115200")
                    .AppendLine("PRINT_SERIAL_DATA_BITS=8")
                    .AppendLine("PRINT_SERIAL_PARITY=none")
                    .AppendLine("PRINT_SERIAL_STOP_BITS=1")
                    .AppendLine("PRINT_SERIAL_RTSCTS=0")
                    .AppendLine("PRINT_POLL_INTERVAL_MS=5000")
                    .AppendLine("PRINT_AGENT_STATE_DIR=" + state)
                    .ToString();
                File.WriteAllText(Path.Combine(root, "agent.env"), env, new UTF8Encoding(false));

                StopAndRemoveService();
                RunSc("create \"" + ServiceName + "\" binPath= \"\\\"" + agentPath + "\\\" --service\" start= auto obj= LocalSystem DisplayName= \"" + ServiceDisplayName + "\"");
                RunSc("description \"" + ServiceName + "\" \"Serviço de impressão do SenhaHub para Bematech MP-4200 TH\"");
                StartService();
                RunIcacls(root);

                SetStatus("Agente instalado e iniciado.", false);
                WriteLog("Instalado em " + root + ".");
                WriteLog("Serviço: " + ServiceName + ".");
            }
            catch (Exception error)
            {
                SetStatus("Falha na instalação: " + error.Message, true);
                WriteLog("Erro: " + error);
            }
            finally
            {
                SetBusy(false);
            }
        }

        private void StopAndRemoveService()
        {
            var query = RunSc("query \"" + ServiceName + "\"", false);
            if (query.ExitCode != 0) return;
            RunSc("stop \"" + ServiceName + "\"", false);
            RunSc("delete \"" + ServiceName + "\"", false);
            for (var attempt = 0; attempt < 20; attempt++)
            {
                System.Threading.Thread.Sleep(250);
                if (RunSc("query \"" + ServiceName + "\"", false).ExitCode != 0) return;
            }
            throw new InvalidOperationException("O serviço anterior ainda está sendo removido.");
        }

        private static void StartService()
        {
            using (var service = new ServiceController(ServiceName))
            {
                service.Start();
                service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
        }

        private static ProcessResult RunSc(string arguments, bool failOnError = true)
        {
            return RunProcess(Path.Combine(Environment.SystemDirectory, "sc.exe"), arguments, failOnError);
        }

        private static void RunIcacls(string path)
        {
            RunProcess(Path.Combine(Environment.SystemDirectory, "icacls.exe"), "\"" + path + "\" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F /T", false);
        }

        private static ProcessResult RunProcess(string fileName, string arguments, bool failOnError)
        {
            var info = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(info))
            {
                var output = process.StandardOutput.ReadToEnd();
                var error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (failOnError && process.ExitCode != 0) throw new InvalidOperationException((error + "\n" + output).Trim());
                return new ProcessResult(process.ExitCode, output, error);
            }
        }

        private static Stream OpenAgentPayload()
        {
            var name = Assembly.GetExecutingAssembly().GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(".SenhaHub.PrintAgent.X86.exe", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("O executável do agente não foi incluído neste instalador.");
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) throw new InvalidOperationException("Não foi possível ler o executável do agente.");
            return stream;
        }

        private void SetBusy(bool busy)
        {
            testButton.Enabled = !busy;
            installButton.Enabled = !busy;
            Cursor = busy ? Cursors.WaitCursor : Cursors.Default;
        }

        private void SetStatus(string message, bool error)
        {
            status.Text = message;
            status.ForeColor = error ? Color.Firebrick : Color.DarkGreen;
        }

        private void WriteLog(string message)
        {
            log.AppendText(DateTime.Now.ToString("HH:mm:ss") + " " + message + Environment.NewLine);
        }
    }

    internal sealed class ProcessResult
    {
        public int ExitCode { get; private set; }
        public string Output { get; private set; }
        public string Error { get; private set; }

        public ProcessResult(int exitCode, string output, string error)
        {
            ExitCode = exitCode;
            Output = output;
            Error = error;
        }
    }
}
