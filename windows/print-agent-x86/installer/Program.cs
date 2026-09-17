using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
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
            enrollmentCode.Text = "IYICETg9w8O4LoL5s9Qu9xa4FltRzl4i";
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

            installButton.Text = "Instalar driver + agente";
            installButton.SetBounds(180, 235, 190, 32);
            installButton.Click += delegate { RepairAndInstallAgent(); };
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
                var printerName = WindowsRawPrinterProbe.FindBematechPrinter();
                if (printerName.Length == 0)
                    throw new InvalidOperationException("Nenhuma fila Bematech foi encontrada. Clique em Instalar driver + agente primeiro.");

                SetStatus("Enviando teste para a fila " + printerName + "...", false);
                NativeSpoolerProbe.Send(printerName, DiagnosticReceipt());
                WriteLog("Teste aceito pela fila " + printerName + ".");
                if (!ConfirmPhysicalPrint(printerName))
                    throw new InvalidOperationException("O Windows aceitou o trabalho, mas a impressora não confirmou papel. Verifique cabo, papel, luzes e a fila da Bematech.");
                SetStatus("Teste físico confirmado.", false);
            }
            catch (Exception error)
            {
                SetStatus("Não foi possível testar a Bematech: " + error.Message, true);
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
                    .AppendLine("KIOSK_PRINTER_MODE=native-serial")
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

        private void RepairAndInstallAgent()
        {
            var url = apiUrl.Text.Trim().TrimEnd('/');
            var code = enrollmentCode.Text.Trim();
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

            try
            {
                SetBusy(true);
                PrepareCleanInstall();
                SetStatus("Instalando o driver Spooler oficial da Bematech...", false);
                var driverPath = ExtractSpoolerDriverPayload();
                var driverResult = RunExternalInstaller(driverPath);
                if (driverResult != 0 && driverResult != 3010)
                    throw new InvalidOperationException("O instalador do driver terminou com o código " + driverResult + ".");

                LoadPorts();
                var port = printerPort.Text.Trim();
                if (port.Length == 0) port = "COM3";
                var printerName = WindowsRawPrinterProbe.FindBematechPrinter();
                if (printerName.Length == 0)
                    throw new InvalidOperationException("O driver foi instalado, mas nenhuma fila Bematech apareceu. Se o instalador pediu, conclua a criação da impressora e tente novamente.");

                SetStatus("Testando a fila " + printerName + "...", false);
                NativeSpoolerProbe.Send(printerName, DiagnosticReceipt());
                WriteLog("Teste aceito pela fila " + printerName + ".");
                if (!ConfirmPhysicalPrint(printerName))
                    throw new InvalidOperationException("O Windows aceitou o trabalho, mas a impressora não confirmou papel. O agente não foi instalado.");

                InstallAgentFiles(url, code, port, "spooler", printerName);
                SetStatus("Teste físico confirmado; agente instalado.", false);
                WriteLog("Driver Spooler Bematech e agente instalados em C:\\ProgramData\\SenhaHub\\PrintAgentX86.");
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
            var output = new System.Collections.Generic.List<byte>();
            output.AddRange(new byte[] { 0x1b, 0x40 });
            // Use the same command-mode switch as the real SenhaHub receipt.
            output.AddRange(new byte[] { 0x1d, 0xf9, 0x20, 0x01 });
            output.AddRange(new byte[] { 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01 });
            output.AddRange(Encoding.ASCII.GetBytes("SenhaHub\r\nTeste de comunicacao\r\n"));
            output.AddRange(new byte[] { 0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x04 });
            return output.ToArray();
        }

        private static bool ConfirmPhysicalPrint(string printerName)
        {
            return MessageBox.Show(
                "O trabalho foi aceito pela fila " + printerName + ".\r\n\r\nSaiu papel na Bematech?",
                "Confirmação do teste físico",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }

        private void PrepareCleanInstall()
        {
            // Remove only the SenhaHub service and files that this installer owns.
            // Keep data\print-agent-x86: it contains the paired device session and
            // the print journal, which prevent duplicate tickets after an upgrade.
            ConfirmFullCleanup();
            StopAndRemoveService();

            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SenhaHub", "PrintAgentX86");
            DeleteOwnedFile(Path.Combine(root, "SenhaHub.PrintAgent.X86.exe"));
            DeleteOwnedFile(Path.Combine(root, "agent.env"));

            var staging = Path.Combine(Path.GetTempPath(), "SenhaHubBematechDriver");
            DeleteOwnedFile(Path.Combine(staging, "Bematech_USBCOM_v4.0.2_2018-09-05.exe"));
            DeleteOwnedFile(Path.Combine(staging, "BematechSpoolerDrivers_x86_v5.0.0.4.exe"));
            RemoveBematechPrintComponents();
            WriteLog("Limpeza concluída: serviço, agente, fila, driver de impressão e cache temporário antigos removidos; pareamento preservado.");
        }

        private static void DeleteOwnedFile(string path)
        {
            if (!File.Exists(path)) return;
            File.SetAttributes(path, FileAttributes.Normal);
            File.Delete(path);
        }

        private void RemoveBematechPrintComponents()
        {
            var script = @"
$ErrorActionPreference = 'Stop'
Import-Module PrintManagement
$printers = @(Get-Printer | Where-Object {
  $_.Name -match '(?i)Bematech|MP[- ]?4200' -or
  $_.DriverName -match '(?i)Bematech|MP[- ]?4200'
})
foreach ($printer in $printers) {
  Write-Output ('Fila removida: ' + $printer.Name)
  Remove-Printer -Name $printer.Name -Confirm:$false -ErrorAction Stop
}
Start-Sleep -Milliseconds 700
$drivers = @(Get-PrinterDriver | Where-Object {
  $_.Name -match '(?i)Bematech|MP[- ]?4200'
})
foreach ($driver in $drivers) {
  try {
    Remove-PrinterDriver -Name $driver.Name -RemoveFromDriverStore -Confirm:$false -ErrorAction Stop
    Write-Output ('Driver removido da loja: ' + $driver.Name)
  } catch {
    Remove-PrinterDriver -Name $driver.Name -Confirm:$false -ErrorAction Stop
    Write-Output ('Driver removido: ' + $driver.Name)
  }
}
";
            var result = RunPowerShell(script);
            var output = (result.Output + Environment.NewLine + result.Error).Trim();
            if (output.Length > 0) WriteLog(output);
            if (result.ExitCode != 0)
                throw new InvalidOperationException("Não foi possível remover completamente o driver Bematech. " + output);
        }

        private void ConfirmFullCleanup()
        {
            var answer = MessageBox.Show(
                "Este reparo vai remover as filas e os drivers de impressão antigos da Bematech/MP-4200 deste computador e reinstalá-los.\r\n\r\nDeseja continuar?",
                "Limpeza do driver Bematech",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button1);
            if (answer != DialogResult.Yes)
                throw new InvalidOperationException("Limpeza dos drivers cancelada pelo operador.");
        }

        private static ProcessResult RunPowerShell(string script)
        {
            var windowsDirectory = Environment.GetEnvironmentVariable("windir") ?? "C:\\Windows";
            var systemPowerShell = Path.Combine(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            if (Environment.Is64BitOperatingSystem)
            {
                var nativePowerShell = Path.Combine(windowsDirectory, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe");
                if (File.Exists(nativePowerShell)) systemPowerShell = nativePowerShell;
            }
            if (!File.Exists(systemPowerShell))
                throw new InvalidOperationException("O Windows PowerShell não foi encontrado.");

            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            return RunProcess(systemPowerShell, "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encoded, false);
        }

        private void InstallAgentFiles(string url, string code, string port, string mode = "native-serial", string printerName = "")
        {
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
                .AppendLine("KIOSK_PRINTER_MODE=" + mode)
                .AppendLine("KIOSK_PRINTER_NAME=" + printerName)
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

            RunSc("create \"" + ServiceName + "\" binPath= \"\\\"" + agentPath + "\\\" --service\" start= auto obj= LocalSystem DisplayName= \"" + ServiceDisplayName + "\"");
            RunSc("description \"" + ServiceName + "\" \"Serviço de impressão do SenhaHub para Bematech MP-4200 TH\"");
            StartService();
            RunIcacls(root);
        }

        private string ExtractDriverPayload()
        {
            var directory = Path.Combine(Path.GetTempPath(), "SenhaHubBematechDriver");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "Bematech_USBCOM_v4.0.2_2018-09-05.exe");
            using (var source = OpenDriverPayload())
            using (var target = File.Create(path)) source.CopyTo(target);
            return path;
        }

        private string ExtractSpoolerDriverPayload()
        {
            var directory = Path.Combine(Path.GetTempPath(), "SenhaHubBematechDriver");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "BematechSpoolerDrivers_x86_v5.0.0.4.exe");
            using (var source = OpenSpoolerDriverPayload())
            using (var target = File.Create(path)) source.CopyTo(target);
            return path;
        }

        private static int RunExternalInstaller(string path)
        {
            var info = new ProcessStartInfo
            {
                FileName = path,
                WorkingDirectory = Path.GetDirectoryName(path),
                UseShellExecute = true
            };
            using (var process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
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
                WorkingDirectory = Path.GetDirectoryName(fileName),
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

        private static Stream OpenDriverPayload()
        {
            var name = Assembly.GetExecutingAssembly().GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(".Bematech_USBCOM_v4.0.2_2018-09-05.exe", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("O driver da Bematech não foi incluído neste instalador.");
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) throw new InvalidOperationException("Não foi possível ler o driver da Bematech.");
            return stream;
        }

        private static Stream OpenSpoolerDriverPayload()
        {
            var name = Assembly.GetExecutingAssembly().GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(".BematechSpoolerDrivers_x86_v5.0.0.4.exe", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("O driver Spooler da Bematech não foi incluído neste instalador.");
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) throw new InvalidOperationException("Não foi possível ler o driver Spooler da Bematech.");
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

    internal static class NativeSerialProbe
    {
        private const uint GenericRead = 0x80000000;
        private const uint GenericWrite = 0x40000000;
        private const uint OpenExisting = 3;
        private const uint FileAttributeNormal = 0x00000080;
        private const uint PurgeRxClear = 0x0008;
        private const uint PurgeTxClear = 0x0004;
        private const uint DcbBinary = 0x00000001;
        private const uint DcbParity = 0x00000002;
        private const uint DcbOutCtsFlow = 0x00000004;
        private const uint DcbOutDsrFlow = 0x00000008;
        private const uint DcbDtrControlMask = 0x00000030;
        private const uint DcbDsrSensitivity = 0x00000040;
        private const uint DcbOutX = 0x00000100;
        private const uint DcbInX = 0x00000200;
        private const uint DcbRtsControlMask = 0x00003000;

        public static void Send(string port, byte[] data)
        {
            var handle = CreateFile("\\\\." + "\\" + port.Trim(), GenericRead | GenericWrite, 0, IntPtr.Zero,
                OpenExisting, FileAttributeNormal, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new IOException(LastError("abrir " + port));

            try
            {
                var dcb = new Dcb { DcbLength = (uint)Marshal.SizeOf(typeof(Dcb)) };
                if (!GetCommState(handle, ref dcb)) throw new IOException(LastError("ler a configuração da porta"));
                dcb.BaudRate = 115200;
                dcb.ByteSize = 8;
                dcb.Parity = 0;
                dcb.StopBits = 0;
                dcb.Flags |= DcbBinary;
                dcb.Flags &= ~(DcbParity | DcbOutCtsFlow | DcbOutDsrFlow | DcbDtrControlMask |
                               DcbDsrSensitivity | DcbOutX | DcbInX | DcbRtsControlMask);
                if (!SetCommState(handle, ref dcb)) throw new IOException(LastError("configurar a porta"));

                var timeouts = new CommTimeouts
                {
                    ReadIntervalTimeout = 0xffffffff,
                    WriteTotalTimeoutConstant = 30000
                };
                if (!SetCommTimeouts(handle, ref timeouts)) throw new IOException(LastError("configurar o tempo limite"));
                if (!PurgeComm(handle, PurgeRxClear | PurgeTxClear)) throw new IOException(LastError("limpar a porta"));

                int written;
                if (!WriteFile(handle, data, data.Length, out written, IntPtr.Zero)) throw new IOException(LastError("enviar o teste"));
                if (written != data.Length) throw new IOException("O Windows enviou apenas " + written + " de " + data.Length + " bytes.");
                if (!FlushFileBuffers(handle)) throw new IOException(LastError("finalizar o teste"));
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        private static string LastError(string operation)
        {
            var error = new Win32Exception(Marshal.GetLastWin32Error());
            return "Não foi possível " + operation + ": " + error.Message + " (código " + error.NativeErrorCode + ").";
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
            uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCommState(IntPtr handle, ref Dcb dcb);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetCommState(IntPtr handle, ref Dcb dcb);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetCommTimeouts(IntPtr handle, ref CommTimeouts timeouts);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PurgeComm(IntPtr handle, uint flags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WriteFile(IntPtr handle, byte[] buffer, int bytesToWrite, out int bytesWritten, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FlushFileBuffers(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        private struct CommTimeouts
        {
            public uint ReadIntervalTimeout;
            public uint ReadTotalTimeoutMultiplier;
            public uint ReadTotalTimeoutConstant;
            public uint WriteTotalTimeoutMultiplier;
            public uint WriteTotalTimeoutConstant;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Dcb
        {
            public uint DcbLength;
            public uint BaudRate;
            public uint Flags;
            public ushort Reserved;
            public ushort XonLimit;
            public ushort XoffLimit;
            public byte ByteSize;
            public byte Parity;
            public byte StopBits;
            public sbyte XonChar;
            public sbyte XoffChar;
            public sbyte ErrorChar;
            public sbyte EofChar;
            public sbyte EvtChar;
            public ushort Reserved1;
        }
    }

    internal static class WindowsRawPrinterProbe
    {
        public static string FindBematechPrinter()
        {
            foreach (string name in PrinterSettings.InstalledPrinters)
            {
                if (name.IndexOf("Bematech", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("MP-4200", StringComparison.OrdinalIgnoreCase) >= 0)
                    return name;
            }
            return "";
        }
    }

    internal static class NativeSpoolerProbe
    {
        public static void Send(string printerName, byte[] data)
        {
            IntPtr handle;
            if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
                throw new IOException(LastError("abrir a fila " + printerName));

            var documentStarted = false;
            var pageStarted = false;
            try
            {
                var document = new DocInfo
                {
                    DocumentName = "SenhaHub",
                    DataType = "RAW"
                };
                if (StartDocPrinter(handle, 1, ref document) == 0)
                    throw new IOException(LastError("iniciar o trabalho de impressão"));
                documentStarted = true;
                if (!StartPagePrinter(handle)) throw new IOException(LastError("iniciar a página"));
                pageStarted = true;
                int written;
                if (!WritePrinter(handle, data, data.Length, out written, IntPtr.Zero))
                    throw new IOException(LastError("enviar o teste para a fila"));
                if (written != data.Length)
                    throw new IOException("A fila aceitou apenas " + written + " de " + data.Length + " bytes.");
            }
            finally
            {
                if (pageStarted) EndPagePrinter(handle);
                if (documentStarted) EndDocPrinter(handle);
                ClosePrinter(handle);
            }
        }

        private static string LastError(string operation)
        {
            var error = new Win32Exception(Marshal.GetLastWin32Error());
            return "Não foi possível " + operation + ": " + error.Message + " (código " + error.NativeErrorCode + ").";
        }

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ClosePrinter(IntPtr printer);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int StartDocPrinter(IntPtr printer, int level, ref DocInfo document);

        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EndDocPrinter(IntPtr printer);

        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool StartPagePrinter(IntPtr printer);

        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EndPagePrinter(IntPtr printer);

        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WritePrinter(IntPtr printer, byte[] data, int count, out int written, IntPtr reserved);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DocInfo
        {
            public string DocumentName;
            public string OutputFile;
            public string DataType;
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
