using System;
using System.Collections.Generic;
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

namespace SenhaHub.PrintAgent.Totem.Setup
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
        private const string ServiceName = "SenhaHubPrintAgentTotem";
        private const string ServiceDisplayName = "SenhaHub Print Agent Totem MP-4000 TH FI";
        private readonly TextBox apiUrl = new TextBox();
        private readonly TextBox enrollmentCode = new TextBox();
        private readonly ComboBox printerPort = new ComboBox();
        private readonly Label status = new Label();
        private readonly TextBox log = new TextBox();
        private readonly Button testButton = new Button();
        private readonly Button installButton = new Button();

        public InstallerForm()
        {
            Text = "Instalação do agente do totem — MP-4000 TH FI — SenhaHub";
            ClientSize = new Size(650, 440);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            AddLabel("Servidor do SenhaHub", 20, 20);
            apiUrl.SetBounds(20, 42, 610, 25);
            apiUrl.Text = "https://senhahub.vercel.app";
            Controls.Add(apiUrl);

            AddLabel("Código de pareamento do totem", 20, 78);
            enrollmentCode.SetBounds(20, 100, 610, 25);
            Controls.Add(enrollmentCode);

            AddLabel("Porta COM da MP-4000 TH FI", 20, 136);
            printerPort.SetBounds(20, 158, 150, 25);
            printerPort.DropDownStyle = ComboBoxStyle.DropDown;
            Controls.Add(printerPort);

            var refreshButton = new Button { Text = "Atualizar portas" };
            refreshButton.SetBounds(180, 157, 120, 27);
            refreshButton.Click += delegate { LoadPorts(); };
            Controls.Add(refreshButton);

            status.AutoSize = false;
            status.SetBounds(20, 195, 610, 38);
            status.ForeColor = Color.DimGray;
            Controls.Add(status);

            testButton.Text = "Testar impressora";
            testButton.SetBounds(20, 245, 160, 32);
            testButton.Click += delegate { TestPrinter(); };
            Controls.Add(testButton);

            installButton.Text = "Instalar agente do totem";
            installButton.SetBounds(190, 245, 210, 32);
            installButton.Click += delegate { InstallAgent(); };
            Controls.Add(installButton);

            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.SetBounds(20, 295, 610, 120);
            Controls.Add(log);

            WriteLog("Perfil: totem-mp4000-th-fi/1.0.0; protocolo fiscal com ACK/ST1/ST2.");
            Load += delegate { LoadPorts(); };
        }

        private void AddLabel(string text, int x, int y)
        {
            var label = new Label { Text = text, AutoSize = true };
            label.SetBounds(x, y, 400, 20);
            Controls.Add(label);
        }

        private void LoadPorts()
        {
            var selected = printerPort.Text;
            printerPort.Items.Clear();
            foreach (var port in SerialPort.GetPortNames().OrderBy(p => p)) printerPort.Items.Add(port);
            if (printerPort.Items.Count == 0) printerPort.Text = string.IsNullOrWhiteSpace(selected) ? "COM3" : selected;
            else if (printerPort.Items.Contains(selected)) printerPort.SelectedItem = selected;
            else if (printerPort.Items.Contains("COM3")) printerPort.SelectedItem = "COM3";
            else if (printerPort.Items.Contains("COM4")) printerPort.SelectedItem = "COM4";
            else printerPort.SelectedIndex = 0;
            WriteLog("Portas encontradas: " + (printerPort.Items.Count == 0 ? "nenhuma" : string.Join(", ", printerPort.Items.Cast<object>())));
        }

        private void TestPrinter()
        {
            try
            {
                SetBusy(true);
                var port = printerPort.Text.Trim();
                if (port.Length == 0) throw new InvalidOperationException("Informe a porta COM da impressora.");
                SetStatus("Enviando relatório de teste para " + port + "...", false);
                Mp4000Probe.Send(port, DiagnosticReceipt());
                WriteLog("Relatório de teste aceito pela MP-4000 TH FI em " + port + ".");
                SetStatus("Teste concluído. Confirme se saiu papel na impressora.", false);
            }
            catch (Exception error)
            {
                SetStatus("Não foi possível testar a MP-4000 TH FI: " + error.Message, true);
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
                SetStatus("Validando a impressora antes de instalar...", false);
                Mp4000Probe.Send(port, DiagnosticReceipt());
                var confirm = MessageBox.Show(
                    "O relatório de teste foi aceito pela MP-4000 TH FI em " + port + ".\r\n\r\nSaiu papel na impressora?",
                    "Confirmação do teste físico",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (confirm != DialogResult.Yes)
                    throw new InvalidOperationException("O agente não foi instalado sem a confirmação física do papel.");

                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgentTotem");
                var state = Path.Combine(root, "data", "print-agent-totem");
                Directory.CreateDirectory(root);
                Directory.CreateDirectory(state);
                StopAndRemoveService();
                var agentPath = Path.Combine(root, "SenhaHub.PrintAgent.Totem.exe");
                using (var source = OpenAgentPayload())
                using (var target = File.Create(agentPath)) source.CopyTo(target);

                var env = new StringBuilder()
                    .AppendLine("PRINT_API_URL=" + url)
                    .AppendLine("PRINT_ENROLLMENT_CODE=" + code)
                    .AppendLine("KIOSK_PRINTER_MODE=mp4000-serial")
                    .AppendLine("KIOSK_PRINTER_PORT=" + port)
                    .AppendLine("PRINT_SERIAL_BAUD_RATE=9600")
                    .AppendLine("PRINT_SERIAL_DATA_BITS=8")
                    .AppendLine("PRINT_SERIAL_PARITY=none")
                    .AppendLine("PRINT_SERIAL_STOP_BITS=1")
                    .AppendLine("PRINT_SERIAL_RTSCTS=1")
                    .AppendLine("PRINT_POLL_INTERVAL_MS=1000")
                    .AppendLine("PRINT_AGENT_STATE_DIR=" + state)
                    .ToString();
                File.WriteAllText(Path.Combine(root, "agent.env"), env, new UTF8Encoding(false));

                RunSc("create \"" + ServiceName + "\" binPath= \"\\\"" + agentPath + "\\\" --service\" start= auto obj= LocalSystem DisplayName= \"" + ServiceDisplayName + "\"");
                RunSc("description \"" + ServiceName + "\" \"Serviço de impressão do Totem SenhaHub para Bematech MP-4000 TH FI.\"");
                StartService();
                RunIcacls(root);

                SetStatus("Agente do totem instalado e iniciado.", false);
                WriteLog("Instalado em " + root + ". Serviço: " + ServiceName + ".");
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

        private static byte[] DiagnosticReceipt()
        {
            var output = new List<byte>();
            AddPacket(output, Combine(new byte[] { 0x1b, 0x14 }, Encoding.ASCII.GetBytes("SenhaHub\r\nTotem MP-4000 TH FI\r\nTeste de comunicacao\r\n")));
            AddPacket(output, new byte[] { 0x1b, 0x15 });
            return output.ToArray();
        }

        private static byte[] Combine(byte[] prefix, byte[] suffix)
        {
            var result = new byte[prefix.Length + suffix.Length];
            Buffer.BlockCopy(prefix, 0, result, 0, prefix.Length);
            Buffer.BlockCopy(suffix, 0, result, prefix.Length, suffix.Length);
            return result;
        }

        private static void AddPacket(List<byte> output, byte[] command)
        {
            var count = command.Length + 2;
            var checksum = 0;
            foreach (var value in command) checksum += value;
            output.Add(0x02);
            output.Add((byte)(count & 0xff));
            output.Add((byte)((count >> 8) & 0xff));
            output.AddRange(command);
            output.Add((byte)(checksum & 0xff));
            output.Add((byte)((checksum >> 8) & 0xff));
        }

        private static Stream OpenAgentPayload()
        {
            var name = Assembly.GetExecutingAssembly().GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(".SenhaHub.PrintAgent.Totem.exe", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("O executável do agente não foi incluído neste instalador.");
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) throw new InvalidOperationException("Não foi possível ler o executável do agente.");
            return stream;
        }

        private static void StopAndRemoveService()
        {
            var query = RunSc("query \"" + ServiceName + "\"", false);
            if (query.ExitCode != 0) return;
            RunSc("stop \"" + ServiceName + "\"", false);
            RunSc("delete \"" + ServiceName + "\"", false);
            for (var attempt = 0; attempt < 20; attempt++)
            {
                Thread.Sleep(250);
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
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "sc.exe"),
                Arguments = arguments,
                WorkingDirectory = Environment.SystemDirectory,
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

        private static void RunIcacls(string path)
        {
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "icacls.exe"),
                Arguments = "\"" + path + "\" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F /T",
                WorkingDirectory = Environment.SystemDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(info)) process.WaitForExit();
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
        public readonly int ExitCode;
        public readonly string Output;
        public readonly string Error;

        public ProcessResult(int exitCode, string output, string error)
        {
            ExitCode = exitCode;
            Output = output;
            Error = error;
        }
    }

    internal static class Mp4000Probe
    {
        public static void Send(string portName, byte[] data)
        {
            using (var port = new SerialPort(portName, 9600, Parity.None, 8, StopBits.One))
            {
                port.Handshake = Handshake.RequestToSend;
                port.DtrEnable = false;
                port.RtsEnable = false;
                port.ReadTimeout = 5000;
                port.WriteTimeout = 30000;
                port.Open();
                port.DiscardInBuffer();
                port.DiscardOutBuffer();

                var offset = 0;
                while (offset < data.Length)
                {
                    if (offset + 5 > data.Length || data[offset] != 0x02) throw new InvalidOperationException("Pacote de teste inválido.");
                    var payloadLength = data[offset + 1] | (data[offset + 2] << 8);
                    var blockLength = 3 + payloadLength;
                    if (payloadLength < 4 || offset + blockLength > data.Length) throw new InvalidOperationException("Tamanho do pacote de teste inválido.");
                    port.Write(data, offset, blockLength);
                    port.BaseStream.Flush();
                    var responseType = port.ReadByte();
                    if (responseType != 0x06) throw new InvalidOperationException("A MP-4000 TH FI rejeitou o teste (resposta " + responseType + ").");
                    var st1 = port.ReadByte();
                    var st2 = port.ReadByte();
                    if (st1 != 0 || st2 != 0) throw new InvalidOperationException("A MP-4000 TH FI retornou status " + st1 + "/" + st2 + ".");
                    offset += blockLength;
                }
            }
        }
    }
}
