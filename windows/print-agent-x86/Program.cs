using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing.Printing;
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
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace SenhaHub.PrintAgent.X86
{
    internal static class AgentProfile
    {
#if MP4000_TOTEM
        public const string DisplayName = "Totem MP-4000 TH FI";
        public const string Version = "totem-mp4000-th-fi/1.0.0";
        public const string ServiceName = "SenhaHubPrintAgentTotem";
        public const string ServiceDisplayName = "SenhaHub Print Agent Totem MP-4000 TH FI";
        public const string DefaultPrinterMode = "mp4000-serial";
        public const string DefaultPrinterPort = "COM3";
        public const int DefaultBaudRate = 9600;
        public const bool DefaultRtsCts = true;
        public const string DefaultStateDirectory = "data\\print-agent-totem";
        public const string StateLogFile = "print-agent-totem.log";
#else
        public const string DisplayName = "Agente x86";
        public const string Version = "windows-x86/1.2.5";
        public const string ServiceName = "SenhaHubPrintAgentX86";
        public const string ServiceDisplayName = "SenhaHub Print Agent x86";
        public const string DefaultPrinterMode = "native-serial";
        public const string DefaultPrinterPort = "COM4";
        public const int DefaultBaudRate = 115200;
        public const bool DefaultRtsCts = false;
        public const string DefaultStateDirectory = "data\\print-agent-x86";
        public const string StateLogFile = "print-agent-x86.log";
#endif
    }

    internal static class Program
    {
        private static readonly CancellationTokenSource Stop = new CancellationTokenSource();

        private static int Main(string[] args)
        {
            try
            {
                if (args.Any(a => string.Equals(a, "--service", StringComparison.OrdinalIgnoreCase)) || !Environment.UserInteractive)
                {
                    ServiceBase.Run(new PrintAgentService(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "agent.env")));
                    return 0;
                }

                Console.OutputEncoding = Encoding.UTF8;
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
                {
                    e.Cancel = true;
                    Stop.Cancel();
                };

                var config = AgentConfig.Load(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "agent.env"));

                if (args.Any(a => string.Equals(a, "--list-ports", StringComparison.OrdinalIgnoreCase)))
                {
                    foreach (var port in SerialPort.GetPortNames().OrderBy(p => p)) Console.WriteLine(port);
                    return 0;
                }

                if (args.Any(a => string.Equals(a, "--test-printer", StringComparison.OrdinalIgnoreCase)))
                {
                    var printer = PrinterTransport.Create(config);
                    printer.Print(ReceiptBuilder.Build(TestPayload()), Stop.Token);
                    Console.WriteLine("Cupom de diagnóstico enviado para " + printer.Target + ".");
                    return 0;
                }

                return RunAsync(config, Stop.Token).GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Falha ao iniciar o " + AgentProfile.DisplayName + ": " + error.Message);
                return 1;
            }
        }

        private static async Task<int> RunAsync(AgentConfig config, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(config.StateDirectory);
            var log = new AgentLog(config.StateDirectory);
            var state = new AgentState(config.StateDirectory);
            var auth = new DeviceAuth(config, state, log);
            var api = new PrintApi(config, auth);
            var printer = PrinterTransport.Create(config);
            var worker = new PrintWorker(config, api, printer, state, log, cancellationToken);

            log.Info(AgentProfile.DisplayName + " iniciado.", new Dictionary<string, object>
            {
                { "version", AgentProfile.Version },
                { "transport", config.PrinterMode },
                { "target", config.PrinterMode == "spooler" ? config.PrinterName : config.PrinterPort },
                { "pollMs", config.PollIntervalMs }
            });

            var failures = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await worker.RunCycleAsync();
                    failures = 0;
                    await Task.Delay(config.PollIntervalMs, cancellationToken);
                }
                catch (ApiException error) when (error.StatusCode == 401 || error.StatusCode == 403)
                {
                    failures++;
                    log.Error("Dispositivo sem autorização; o journal foi preservado.", new Dictionary<string, object>
                    {
                        { "status", error.StatusCode }
                    });
                    await Task.Delay(Math.Min(600000, 30000 * Math.Min(16, failures)), cancellationToken);
                }
                catch (NeedsReviewException error)
                {
                    log.Error(error.Message, null);
                    await Task.Delay(60000, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception error)
                {
                    failures++;
                    log.Error("Ciclo de impressão interrompido.", new Dictionary<string, object>
                    {
                        { "message", error.Message },
                        { "failures", failures }
                    });
                    await Task.Delay(Math.Min(300000, 15000 * Math.Min(16, failures)), cancellationToken);
                }
            }

            log.Info(AgentProfile.DisplayName + " encerrado.", null);
            return 0;
        }

        internal static Task<int> RunServiceAsync(AgentConfig config, CancellationToken cancellationToken)
        {
            return RunAsync(config, cancellationToken);
        }

        private static Dictionary<string, object> TestPayload()
        {
            return new Dictionary<string, object>
            {
                { "ticketCode", "T001" },
                { "sectorName", "Teste" },
                { "issuedAt", DateTimeOffset.UtcNow.ToString("o") },
                { "trackUrl", "" }
            };
        }
    }

    internal sealed class PrintAgentService : ServiceBase
    {
        private readonly string configPath;
        private readonly CancellationTokenSource stop = new CancellationTokenSource();
        private Thread workerThread;

        public PrintAgentService(string configPath)
        {
            this.configPath = configPath;
            ServiceName = AgentProfile.ServiceName;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            workerThread = new Thread(RunWorker);
            workerThread.IsBackground = true;
            workerThread.Start();
        }

        protected override void OnStop()
        {
            stop.Cancel();
            if (workerThread != null && workerThread.IsAlive) workerThread.Join(TimeSpan.FromSeconds(20));
        }

        protected override void OnShutdown()
        {
            OnStop();
            base.OnShutdown();
        }

        private void RunWorker()
        {
            try
            {
                var config = AgentConfig.Load(configPath);
                Program.RunServiceAsync(config, stop.Token).GetAwaiter().GetResult();
            }
            catch (Exception error)
            {
                try
                {
                    var directory = Path.GetDirectoryName(configPath);
                    if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                    File.AppendAllText(
                        Path.Combine(directory ?? AppDomain.CurrentDomain.BaseDirectory, "service-startup.log"),
                        DateTime.Now.ToString("o") + " " + error + Environment.NewLine,
                        Encoding.UTF8);
                }
                catch
                {
                    // Preserve the service process even when startup diagnostics cannot be written.
                }
            }
        }
    }

    internal sealed class AgentConfig
    {
        public string ApiUrl;
        public string EnrollmentCode;
        public string LocalToken;
        public string PrinterMode;
        public string PrinterName;
        public string PrinterPort;
        public int BaudRate;
        public int DataBits;
        public StopBits StopBits;
        public Parity Parity;
        public bool RtsCts;
        public int PollIntervalMs;
        public string StateDirectory;

        public static AgentConfig Load(string path)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (File.Exists(path))
            {
                foreach (var raw in File.ReadAllLines(path, Encoding.UTF8))
                {
                    var line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    var equals = line.IndexOf('=');
                    if (equals <= 0) continue;
                    var key = line.Substring(0, equals).Trim();
                    var value = line.Substring(equals + 1).Trim();
                    if (value.Length >= 2 && ((value[0] == '"' && value[value.Length - 1] == '"') || (value[0] == '\'' && value[value.Length - 1] == '\'')))
                        value = value.Substring(1, value.Length - 2);
                    values[key] = value;
                }
            }

            var config = new AgentConfig
            {
                ApiUrl = Get(values, "PRINT_API_URL", "https://senhahub.vercel.app").TrimEnd('/'),
                EnrollmentCode = Get(values, "PRINT_ENROLLMENT_CODE", ""),
                LocalToken = Get(values, "PRINT_DEVICE_LOCAL_TOKEN", ""),
                PrinterMode = Get(values, "KIOSK_PRINTER_MODE", AgentProfile.DefaultPrinterMode).Trim().ToLowerInvariant(),
                PrinterName = Get(values, "KIOSK_PRINTER_NAME", "").Trim(),
                PrinterPort = Get(values, "KIOSK_PRINTER_PORT", AgentProfile.DefaultPrinterPort),
                BaudRate = PositiveInt(Get(values, "PRINT_SERIAL_BAUD_RATE", AgentProfile.DefaultBaudRate.ToString()), AgentProfile.DefaultBaudRate),
                DataBits = Get(values, "PRINT_SERIAL_DATA_BITS", "8") == "7" ? 7 : 8,
                StopBits = Get(values, "PRINT_SERIAL_STOP_BITS", "1") == "2" ? StopBits.Two : StopBits.One,
                Parity = ParseParity(Get(values, "PRINT_SERIAL_PARITY", "none")),
                RtsCts = ParseFlag(Get(values, "PRINT_SERIAL_RTSCTS", AgentProfile.DefaultRtsCts ? "1" : "0")),
                PollIntervalMs = Math.Max(5000, PositiveInt(Get(values, "PRINT_POLL_INTERVAL_MS", "5000"), 5000)),
                StateDirectory = Get(values, "PRINT_AGENT_STATE_DIR", AgentProfile.DefaultStateDirectory)
            };

            if (!config.ApiUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !IsLoopback(config.ApiUrl))
                throw new InvalidOperationException("PRINT_API_URL deve usar HTTPS.");
            if (config.EnrollmentCode.Length == 0 && config.LocalToken.Length == 0)
                throw new InvalidOperationException("Informe PRINT_ENROLLMENT_CODE no primeiro pareamento.");
            if (config.PrinterMode != "native-serial" && config.PrinterMode != "serial" && config.PrinterMode != "spooler" && config.PrinterMode != "mp4000-serial")
                throw new InvalidOperationException("KIOSK_PRINTER_MODE deve ser native-serial, serial, spooler ou mp4000-serial.");
            if (config.PrinterMode == "spooler" && config.PrinterName.Length == 0)
                throw new InvalidOperationException("Informe KIOSK_PRINTER_NAME para o modo spooler.");
            if (config.StateDirectory.Length == 0) config.StateDirectory = AgentProfile.DefaultStateDirectory;
            if (!Path.IsPathRooted(config.StateDirectory)) config.StateDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, config.StateDirectory);
            return config;
        }

        private static string Get(Dictionary<string, string> values, string key, string fallback)
        {
            string value;
            return values.TryGetValue(key, out value) ? value : fallback;
        }

        private static int PositiveInt(string value, int fallback)
        {
            int number;
            return int.TryParse(value, out number) && number > 0 ? number : fallback;
        }

        private static Parity ParseParity(string value)
        {
            if (string.Equals(value, "even", StringComparison.OrdinalIgnoreCase)) return Parity.Even;
            if (string.Equals(value, "odd", StringComparison.OrdinalIgnoreCase)) return Parity.Odd;
            return Parity.None;
        }

        private static bool ParseFlag(string value)
        {
            return value == "1" || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase) || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsLoopback(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttp &&
                   (uri.Host == "localhost" || uri.Host == "127.0.0.1" || uri.Host == "::1");
        }
    }

    internal sealed class DeviceAuth
    {
        private readonly AgentConfig config;
        private readonly AgentState state;
        private readonly AgentLog log;
        private readonly HttpClient http = HttpFactory.Create();

        public DeviceAuth(AgentConfig config, AgentState state, AgentLog log)
        {
            this.config = config;
            this.state = state;
            this.log = log;
        }

        public bool UsesLocalToken { get { return config.LocalToken.Length > 0; } }

        public async Task<string> GetTokenAsync()
        {
            if (UsesLocalToken) return config.LocalToken;
            var session = state.LoadSession();
            if (session == null)
            {
                if (config.EnrollmentCode.Length == 0) throw new InvalidOperationException("Pareamento necessário: informe PRINT_ENROLLMENT_CODE.");
                session = await EnrollAsync(config.EnrollmentCode);
                state.SaveSession(session);
                log.Info("Dispositivo pareado com sucesso.", null);
            }
            return session.AccessToken;
        }

        public async Task<string> RefreshAsync()
        {
            if (UsesLocalToken) return config.LocalToken;
            var session = state.LoadSession();
            if (session == null) return await GetTokenAsync();
            var request = new Dictionary<string, object> { { "refresh_token", session.RefreshToken } };
            using (var message = new HttpRequestMessage(HttpMethod.Post, session.SupabaseUrl.TrimEnd('/') + "/auth/v1/token?grant_type=refresh_token"))
            {
                message.Headers.Add("apikey", session.SupabaseKey);
                message.Content = new StringContent(Json.Serialize(request), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(message))
                {
                    var body = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode) throw new ApiException((int)response.StatusCode, body);
                    var data = Json.ParseObject(body);
                    var refreshed = SessionData.FromRefresh(session, data);
                    state.SaveSession(refreshed);
                    return refreshed.AccessToken;
                }
            }
        }

        private async Task<SessionData> EnrollAsync(string code)
        {
            using (var message = new HttpRequestMessage(HttpMethod.Post, config.ApiUrl + "/api/print/v2/enroll"))
            {
                message.Content = new StringContent(Json.Serialize(new Dictionary<string, object> { { "code", code } }), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(message))
                {
                    var body = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode) throw new ApiException((int)response.StatusCode, body);
                    var data = Json.ParseObject(body);
                    var session = Json.Object(data, "session");
                    if (session == null) throw new InvalidOperationException("O servidor não devolveu uma sessão de dispositivo.");
                    return SessionData.FromEnrollment(data, session);
                }
            }
        }
    }

    internal sealed class PrintApi
    {
        private readonly AgentConfig config;
        private readonly DeviceAuth auth;
        private readonly HttpClient http = HttpFactory.Create();

        public PrintApi(AgentConfig config, DeviceAuth auth)
        {
            this.config = config;
            this.auth = auth;
        }

        public async Task<Dictionary<string, object>> CommandAsync(string command, Dictionary<string, object> body)
        {
            var token = await auth.GetTokenAsync();
            try
            {
                return await SendAsync(command, body, token);
            }
            catch (ApiException error) when (error.StatusCode == 401 && !auth.UsesLocalToken)
            {
                return await SendAsync(command, body, await auth.RefreshAsync());
            }
        }

        private async Task<Dictionary<string, object>> SendAsync(string command, Dictionary<string, object> body, string token)
        {
            using (var message = new HttpRequestMessage(HttpMethod.Post, config.ApiUrl + "/api/print/v2/" + command))
            {
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                message.Headers.Add("x-print-agent-version", AgentProfile.Version);
                message.Content = new StringContent(Json.Serialize(body ?? new Dictionary<string, object>()), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(message))
                {
                    var responseBody = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode) throw new ApiException((int)response.StatusCode, responseBody);
                    return Json.ParseObject(responseBody);
                }
            }
        }
    }

    internal sealed class PrintWorker
    {
        private readonly AgentConfig config;
        private readonly PrintApi api;
        private readonly IPrinter printer;
        private readonly AgentState state;
        private readonly AgentLog log;
        private readonly CancellationToken stop;
        private bool needsReview;

        public PrintWorker(AgentConfig config, PrintApi api, IPrinter printer, AgentState state, AgentLog log, CancellationToken stop)
        {
            this.config = config;
            this.api = api;
            this.printer = printer;
            this.state = state;
            this.log = log;
            this.stop = stop;
        }

        public async Task RunCycleAsync()
        {
            needsReview = false;
            await RecoverAsync();
            if (needsReview) throw new NeedsReviewException("A impressora está bloqueada para revisão no painel administrativo.");

            var claimRequestId = state.LoadClaimRequestId();
            if (claimRequestId == null)
            {
                claimRequestId = Guid.NewGuid().ToString();
                state.SaveClaimRequestId(claimRequestId);
            }

            Dictionary<string, object> claimed;
            try
            {
                claimed = await api.CommandAsync("claim", new Dictionary<string, object> { { "requestId", claimRequestId } });
            }
            catch (ApiException error) when (error.StatusCode == 409)
            {
                state.ClearClaimRequestId();
                throw;
            }
            state.ClearClaimRequestId();

            var job = Json.Object(claimed, "job");
            if (job == null) return;
            var status = Json.String(job, "status");
            if (status != "leased")
            {
                if (status == "printing" || status == "needs_review") await ReportUnknownAsync(job);
                return;
            }

            await ProcessAsync(job);
        }

        private async Task RecoverAsync()
        {
            var pending = state.LoadExecution();
            if (pending != null)
            {
                var outcome = pending.Outcome;
                var error = pending.Error;
                if (string.IsNullOrEmpty(outcome))
                {
                    outcome = pending.Phase == "leased" ? "before_send" : "unknown";
                    error = "Agente reiniciado antes de confirmar o resultado físico.";
                    state.SaveExecution(pending.Job, "result", outcome, error);
                }
                await FinishAsync(pending.Job, outcome, error);
            }

            var recovered = await api.CommandAsync("recover", new Dictionary<string, object>());
            var job = Json.Object(recovered, "job");
            if (job == null) return;
            var status = Json.String(job, "status");
            if (status == "leased")
            {
                state.SaveExecution(job, "result", "before_send", "Lease recuperado antes do envio.");
                await FinishAsync(job, "before_send", "Lease recuperado antes do envio.");
            }
            else if (status == "printing")
            {
                await ReportUnknownAsync(job);
            }
            else if (status == "needs_review")
            {
                needsReview = true;
            }
        }

        private async Task ProcessAsync(Dictionary<string, object> job)
        {
            var processStartedAt = Environment.TickCount;
            state.SaveExecution(job, "leased", null, null);
            byte[] receipt;
            try
            {
                var payload = Json.Object(job, "payload");
                if (payload == null || string.IsNullOrEmpty(Json.String(payload, "ticketCode"))) throw new InvalidOperationException("Recibo inválido.");
                receipt = ReceiptBuilder.Build(payload);
            }
            catch (Exception error)
            {
                state.SaveExecution(job, "result", "before_send", error.Message);
                await FinishAsync(job, "before_send", error.Message);
                return;
            }

            state.SaveExecution(job, "starting", null, null);
            var startRequestStartedAt = Environment.TickCount;
            var started = await api.CommandAsync("start", Ownership(job));
            var startRequestMs = ElapsedMilliseconds(startRequestStartedAt);
            var startedJob = Json.Object(started, "job");
            if (startedJob == null || Json.String(startedJob, "status") != "printing") throw new InvalidOperationException("O servidor não aceitou o início da impressão.");
            var expiresAt = Json.ParseDateTime(startedJob, "lease_expires_at");
            if (expiresAt.HasValue && expiresAt.Value < DateTimeOffset.UtcNow.AddSeconds(15)) throw new InvalidOperationException("Lease muito próximo do vencimento.");

            state.SaveExecution(job, "writing", null, null);
            string outcome = "printed";
            string errorMessage = null;
            var printerStartedAt = Environment.TickCount;
            try
            {
                printer.Print(receipt, stop);
            }
            catch (PrintException error)
            {
                outcome = error.BeforeSend ? "before_send" : "unknown";
                errorMessage = error.BeforeSend ? "Impressora indisponível antes do envio." : "Resultado físico incerto; impressão não será repetida automaticamente.";
            }
            var printerMs = ElapsedMilliseconds(printerStartedAt);

            state.SaveExecution(job, "result", outcome, errorMessage);
            var finishRequestStartedAt = Environment.TickCount;
            await FinishAsync(job, outcome, errorMessage);
            log.Info("Tempos do trabalho de impressão.", new Dictionary<string, object>
            {
                { "jobId", Json.String(job, "id") },
                { "receiptBytes", receipt.Length },
                { "startRequestMs", startRequestMs },
                { "printerMs", printerMs },
                { "finishRequestMs", ElapsedMilliseconds(finishRequestStartedAt) },
                { "totalMs", ElapsedMilliseconds(processStartedAt) },
                { "outcome", outcome }
            });
        }

        private async Task ReportUnknownAsync(Dictionary<string, object> job)
        {
            state.SaveExecution(job, "result", "unknown", "Resultado físico indisponível.");
            await FinishAsync(job, "unknown", "Resultado físico indisponível.");
            needsReview = true;
        }

        private async Task FinishAsync(Dictionary<string, object> job, string outcome, string error)
        {
            var body = Ownership(job);
            body["outcome"] = outcome;
            body["error"] = error ?? "";
            var result = await api.CommandAsync("finish", body);
            state.ClearExecution();
            var finishedJob = Json.Object(result, "job");
            if (finishedJob != null && Json.String(finishedJob, "status") == "needs_review") needsReview = true;
            log.Info("Trabalho de impressão confirmado.", new Dictionary<string, object>
            {
                { "jobId", Json.String(job, "id") },
                { "outcome", outcome }
            });
        }

        private static Dictionary<string, object> Ownership(Dictionary<string, object> job)
        {
            return new Dictionary<string, object>
            {
                { "jobId", Json.String(job, "id") },
                { "leaseId", Json.String(job, "lease_id") },
                { "attemptVersion", Json.Int(job, "attempt_version") }
            };
        }

        private static int ElapsedMilliseconds(int startedAt)
        {
            return Math.Max(0, unchecked(Environment.TickCount - startedAt));
        }
    }

    internal interface IPrinter
    {
        string Target { get; }
        void Print(byte[] data, CancellationToken stop);
    }

    internal static class PrinterTransport
    {
        public static IPrinter Create(AgentConfig config)
        {
            if (config.PrinterMode == "spooler") return new WindowsRawPrinter(config.PrinterName);
            if (config.PrinterMode == "native-serial") return new NativeSerialPrinter(config);
            if (config.PrinterMode == "mp4000-serial") return new Mp4000FiscalPrinter(config);
            return new SerialPrinter(config);
        }
    }

    internal sealed class WindowsRawPrinter : IPrinter
    {
        private readonly string printerName;

        public WindowsRawPrinter(string printerName)
        {
            this.printerName = (printerName ?? "").Trim();
            if (this.printerName.Length == 0) throw new InvalidOperationException("Nome da fila do Windows não informado.");
        }

        public string Target { get { return "fila Windows " + printerName; } }

        public void Print(byte[] data, CancellationToken stop)
        {
            if (data == null || data.Length == 0) throw new PrintException("Conteúdo vazio.", true);

            IntPtr handle;
            if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
                throw new PrintException(LastError("abrir a fila " + printerName), true);

            var beforeSend = true;
            var documentStarted = false;
            var pageStarted = false;
            try
            {
                stop.ThrowIfCancellationRequested();
                var document = new DocInfo
                {
                    DocumentName = "SenhaHub",
                    DataType = "RAW"
                };
                if (StartDocPrinter(handle, 1, ref document) == 0)
                    throw new InvalidOperationException(LastError("iniciar o trabalho de impressão"));
                documentStarted = true;
                if (!StartPagePrinter(handle))
                    throw new InvalidOperationException(LastError("iniciar a página"));
                pageStarted = true;

                stop.ThrowIfCancellationRequested();
                beforeSend = false;
                int written;
                if (!WritePrinter(handle, data, data.Length, out written, IntPtr.Zero))
                    throw new InvalidOperationException(LastError("enviar o cupom para a fila"));
                if (written != data.Length)
                    throw new InvalidOperationException("A fila aceitou apenas " + written + " de " + data.Length + " bytes.");
            }
            catch (PrintException)
            {
                throw;
            }
            catch (Exception error)
            {
                throw new PrintException(error.Message, beforeSend, error);
            }
            finally
            {
                if (pageStarted) EndPagePrinter(handle);
                if (documentStarted) EndDocPrinter(handle);
                ClosePrinter(handle);
            }
        }

        public static string FindBematechPrinter()
        {
            foreach (string name in PrinterSettings.InstalledPrinters)
            {
                if (name.IndexOf("Bematech", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("MP-4200", StringComparison.OrdinalIgnoreCase) >= 0)
                    return name;
            }
            return null;
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

    // Uses the Windows communication API directly. This avoids the .NET
    // SerialPort initialization path that can fail with ERROR_SEM_TIMEOUT on
    // some Bematech USB/serial drivers.
    internal sealed class NativeSerialPrinter : IPrinter
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
        private const uint DcbRtsHandshake = 0x00002000;

        private readonly AgentConfig config;

        public NativeSerialPrinter(AgentConfig config)
        {
            this.config = config;
        }

        public string Target { get { return "Win32 " + config.PrinterPort; } }

        public void Print(byte[] data, CancellationToken stop)
        {
            if (data == null || data.Length == 0) throw new PrintException("Conteúdo vazio.", true);

            var handle = CreateFile(
                ToDevicePath(config.PrinterPort),
                GenericRead | GenericWrite,
                0,
                IntPtr.Zero,
                OpenExisting,
                FileAttributeNormal,
                IntPtr.Zero);
            if (handle == new IntPtr(-1))
            {
                throw new PrintException(LastError("abrir " + config.PrinterPort), true);
            }

            var beforeSend = true;
            try
            {
                stop.ThrowIfCancellationRequested();
                Configure(handle);
                if (!PurgeComm(handle, PurgeRxClear | PurgeTxClear))
                    throw new InvalidOperationException(LastError("limpar a porta"));

                stop.ThrowIfCancellationRequested();
                beforeSend = false;
                int written;
                if (!WriteFile(handle, data, data.Length, out written, IntPtr.Zero))
                    throw new InvalidOperationException(LastError("enviar o cupom"));
                if (written != data.Length)
                    throw new InvalidOperationException("O Windows enviou apenas " + written + " de " + data.Length + " bytes.");
                if (!FlushFileBuffers(handle))
                    throw new InvalidOperationException(LastError("finalizar o envio"));

                var waitMs = Math.Max(500, (int)Math.Ceiling(data.Length * 10.0 * 1000.0 / config.BaudRate));
                var started = Environment.TickCount;
                while (Environment.TickCount - started < waitMs)
                {
                    stop.ThrowIfCancellationRequested();
                    Thread.Sleep(Math.Min(100, waitMs));
                }
            }
            catch (PrintException)
            {
                throw;
            }
            catch (Exception error)
            {
                throw new PrintException(error.Message, beforeSend, error);
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        private void Configure(IntPtr handle)
        {
            var dcb = new Dcb { DcbLength = (uint)Marshal.SizeOf(typeof(Dcb)) };
            if (!GetCommState(handle, ref dcb)) throw new InvalidOperationException(LastError("ler a configuração da porta"));

            dcb.BaudRate = (uint)config.BaudRate;
            dcb.ByteSize = (byte)config.DataBits;
            dcb.Parity = (byte)ToNativeParity(config.Parity);
            dcb.StopBits = (byte)ToNativeStopBits(config.StopBits);
            dcb.Flags |= DcbBinary;
            dcb.Flags &= ~(DcbParity | DcbOutCtsFlow | DcbOutDsrFlow | DcbDtrControlMask |
                           DcbDsrSensitivity | DcbOutX | DcbInX | DcbRtsControlMask);
            if (config.Parity != Parity.None) dcb.Flags |= DcbParity;
            if (config.RtsCts) dcb.Flags |= DcbOutCtsFlow | DcbRtsHandshake;

            if (!SetCommState(handle, ref dcb)) throw new InvalidOperationException(LastError("configurar a porta"));

            var timeouts = new CommTimeouts
            {
                ReadIntervalTimeout = 0xffffffff,
                ReadTotalTimeoutMultiplier = 0,
                ReadTotalTimeoutConstant = 0,
                WriteTotalTimeoutMultiplier = 0,
                WriteTotalTimeoutConstant = 30000
            };
            if (!SetCommTimeouts(handle, ref timeouts)) throw new InvalidOperationException(LastError("configurar o tempo limite"));
        }

        private static byte ToNativeParity(Parity parity)
        {
            if (parity == Parity.Odd) return 1;
            if (parity == Parity.Even) return 2;
            return 0;
        }

        private static byte ToNativeStopBits(StopBits stopBits)
        {
            return stopBits == StopBits.Two ? (byte)2 : (byte)0;
        }

        private static string ToDevicePath(string port)
        {
            port = (port ?? "").Trim();
            return port.StartsWith("\\\\.\\", StringComparison.Ordinal) ? port : "\\\\." + "\\" + port;
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

    internal sealed class SerialPrinter : IPrinter
    {
        private readonly AgentConfig config;

        public SerialPrinter(AgentConfig config)
        {
            this.config = config;
        }

        public string Target { get { return config.PrinterPort; } }

        public void Print(byte[] data, CancellationToken stop)
        {
            if (data == null || data.Length == 0) throw new PrintException("Conteúdo vazio.", true);
            using (var port = new SerialPort(config.PrinterPort, config.BaudRate, config.Parity, config.DataBits, config.StopBits))
            {
                port.Handshake = config.RtsCts ? Handshake.RequestToSend : Handshake.None;
                port.DtrEnable = false;
                port.RtsEnable = false;
                port.WriteTimeout = 30000;
                port.ReadTimeout = 1500;
                var beforeSend = true;
                try
                {
                    stop.ThrowIfCancellationRequested();
                    port.Open();
                    stop.ThrowIfCancellationRequested();
                    beforeSend = false;
                    port.Write(data, 0, data.Length);
                    port.BaseStream.Flush();
                    var waitMs = Math.Max(500, (int)Math.Ceiling(data.Length * 10.0 * 1000.0 / config.BaudRate));
                    var started = Environment.TickCount;
                    while (Environment.TickCount - started < waitMs)
                    {
                        stop.ThrowIfCancellationRequested();
                        Thread.Sleep(Math.Min(100, waitMs));
                    }
                }
                catch (PrintException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    throw new PrintException(error.Message, beforeSend, error);
                }
            }
        }
    }

    internal sealed class Mp4000FiscalPrinter : IPrinter
    {
        private const byte Ack = 0x06;
        private const byte Nak = 0x15;
        private const byte StartOfText = 0x02;
        private readonly AgentConfig config;

        public Mp4000FiscalPrinter(AgentConfig config)
        {
            this.config = config;
        }

        public string Target { get { return "MP-4000 TH FI " + config.PrinterPort; } }

        public void Print(byte[] data, CancellationToken stop)
        {
            if (data == null || data.Length == 0) throw new PrintException("Conteúdo vazio.", true);

            using (var port = new SerialPort(config.PrinterPort, config.BaudRate, config.Parity, config.DataBits, config.StopBits))
            {
                port.Handshake = config.RtsCts ? Handshake.RequestToSend : Handshake.None;
                port.DtrEnable = false;
                port.RtsEnable = false;
                port.ReadTimeout = 5000;
                port.WriteTimeout = 30000;

                var beforeSend = true;
                try
                {
                    stop.ThrowIfCancellationRequested();
                    port.Open();
                    port.DiscardInBuffer();
                    port.DiscardOutBuffer();

                    var offset = 0;
                    while (offset < data.Length)
                    {
                        stop.ThrowIfCancellationRequested();
                        var blockLength = ReadBlockLength(data, offset);
                        var block = new byte[blockLength];
                        Buffer.BlockCopy(data, offset, block, 0, blockLength);
                        beforeSend = false;
                        port.Write(block, 0, block.Length);
                        port.BaseStream.Flush();

                        var responseType = ReadExact(port, 1, stop)[0];
                        if (responseType == Nak)
                            throw new PrintException("A MP-4000 TH FI rejeitou o comando fiscal.", false);
                        if (responseType != Ack)
                            throw new PrintException("Resposta inválida da MP-4000 TH FI: byte " + responseType + ".", false);
                        var responseStatus = ReadExact(port, 2, stop);
                        if (responseStatus[0] != 0 || responseStatus[1] != 0)
                            throw new PrintException(FormatStatus(responseStatus[0], responseStatus[1]), false);

                        offset += blockLength;
                    }
                }
                catch (PrintException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    throw new PrintException(error.Message, beforeSend, error);
                }
            }
        }

        private static int ReadBlockLength(byte[] data, int offset)
        {
            if (offset < 0 || offset + 5 > data.Length || data[offset] != StartOfText)
                throw new PrintException("Pacote da MP-4000 TH FI inválido.", true);

            var payloadLength = data[offset + 1] | (data[offset + 2] << 8);
            var blockLength = 3 + payloadLength;
            if (payloadLength < 4 || offset + blockLength > data.Length)
                throw new PrintException("Tamanho do pacote da MP-4000 TH FI inválido.", true);
            return blockLength;
        }

        private static byte[] ReadExact(SerialPort port, int length, CancellationToken stop)
        {
            var result = new byte[length];
            var read = 0;
            while (read < length)
            {
                stop.ThrowIfCancellationRequested();
                var count = port.Read(result, read, length - read);
                if (count <= 0) throw new System.TimeoutException("A MP-4000 TH FI não respondeu ao comando.");
                read += count;
            }
            return result;
        }

        private static string FormatStatus(byte st1, byte st2)
        {
            var errors = new List<string>();
            if ((st1 & 0x80) != 0) errors.Add("sem papel");
            if ((st1 & 0x40) != 0) errors.Add("pouco papel");
            if ((st1 & 0x20) != 0) errors.Add("erro no relógio");
            if ((st1 & 0x10) != 0) errors.Add("impressora em erro");
            if ((st1 & 0x08) != 0) errors.Add("comando inválido");
            if ((st1 & 0x04) != 0) errors.Add("comando inexistente");
            if ((st1 & 0x02) != 0) errors.Add("documento aberto");
            if ((st1 & 0x01) != 0) errors.Add("parâmetro inválido");
            if ((st2 & 0x80) != 0) errors.Add("tipo de parâmetro inválido");
            if ((st2 & 0x40) != 0) errors.Add("memória fiscal cheia");
            if ((st2 & 0x20) != 0) errors.Add("erro na memória não volátil");
            if (errors.Count == 0) errors.Add("status fiscal não-zero");
            return "A MP-4000 TH FI retornou status " + st1 + "/" + st2 + ": " + string.Join(", ", errors) + ".";
        }
    }

    internal static class ReceiptBuilder
    {
        private const byte Esc = 0x1b;
        private const byte Gs = 0x1d;
        private const byte Lf = 0x0a;

        public static byte[] Build(Dictionary<string, object> payload)
        {
#if MP4000_TOTEM
            return Mp4000ReceiptBuilder.Build(payload);
#else
            var output = new List<byte>();
            Command(output, Esc, 0x40);
            Command(output, Gs, 0xf9, 0x20, 0x01);
            Command(output, Esc, 0x61, 1);
            Command(output, Esc, 0x45, 1);
            Command(output, Gs, 0x21, 0x01);
            Line(output, "SUPERMERCADO POMPEIA");
            Command(output, Gs, 0x21, 0x00);
            Line(output, "SenhaHub");

            var tickets = Json.Array(payload, "tickets");
            if (tickets.Count == 0) tickets.Add(payload);
            foreach (var item in tickets.Take(12))
            {
                var ticket = item as Dictionary<string, object> ?? payload;
                Line(output, CleanText(Json.String(ticket, "sectorName") ?? Json.String(payload, "sectorName") ?? "SETOR", 60).ToUpperInvariant());
                Command(output, Esc, 0x45, 1);
                Line(output, "SENHA");
                Command(output, Gs, 0x21, 0x33);
                Line(output, CleanText(Json.String(ticket, "ticketCode") ?? Json.String(payload, "ticketCode") ?? "---", 16));
                Command(output, Gs, 0x21, 0x00);
                Command(output, Esc, 0x45, 0);
            }

            Command(output, Esc, 0x64, 1);
            var trackUrl = CleanUrl(Json.String(payload, "trackUrl"));
            if (trackUrl.Length == 0) Line(output, "QR Code indisponivel");
            else QrCode(output, trackUrl);
            Line(output, "Escaneie o QR Code para acompanhar");
            Command(output, Esc, 0x64, 3);
            Command(output, Gs, 0x56, 0x42, 0x04);
            return output.ToArray();
#endif
        }

        private static void QrCode(List<byte> output, string value)
        {
            var data = Encoding.UTF8.GetBytes(value);
            var length = data.Length + 3;
            Command(output, Gs, 0x28, 0x6b, 4, 0, 49, 65, 50, 0);
            Command(output, Gs, 0x28, 0x6b, 3, 0, 49, 67, 6);
            Command(output, Gs, 0x28, 0x6b, 3, 0, 49, 69, 49);
            Command(output, Gs, 0x28, 0x6b, (byte)(length & 0xff), (byte)((length >> 8) & 0xff), 49, 80, 48);
            output.AddRange(data);
            Command(output, Gs, 0x28, 0x6b, 3, 0, 49, 81, 48);
        }

        private static void Line(List<byte> output, string value)
        {
            output.AddRange(Encoding.ASCII.GetBytes(CleanText(value, 160)));
            output.Add(Lf);
        }

        private static void Command(List<byte> output, params byte[] bytes)
        {
            output.AddRange(bytes);
        }

        private static string CleanText(string value, int maxLength)
        {
            if (value == null) value = "";
            value = Regex.Replace(value.Normalize(NormalizationForm.FormD), "\\p{Mn}+", "");
            value = new string(value.Where(c => c >= 0x20 && c <= 0x7e).ToArray());
            value = Regex.Replace(value, "\\s+", " ").Trim();
            return value.Length > maxLength ? value.Substring(0, maxLength) : value;
        }

        private static string CleanUrl(string value)
        {
            if (value == null) return "";
            value = new string(value.Where(c => c >= 0x20 && c != 0x7f).ToArray()).Trim();
            return value.Length > 512 ? value.Substring(0, 512) : value;
        }
    }

    internal static class Mp4000ReceiptBuilder
    {
        private const byte Stx = 0x02;
        private const byte Esc = 0x1b;
        private const int MaxTextBytesPerCommand = 600;

        public static byte[] Build(Dictionary<string, object> payload)
        {
            var lines = new List<string>
            {
                "SUPERMERCADO POMPEIA",
                "SenhaHub"
            };

            var tickets = Json.Array(payload, "tickets");
            if (tickets.Count == 0) tickets.Add(payload);
            foreach (var item in tickets.Take(12))
            {
                var ticket = item as Dictionary<string, object> ?? payload;
                lines.Add(CleanText(Json.String(ticket, "sectorName") ?? Json.String(payload, "sectorName") ?? "SETOR", 60).ToUpperInvariant());
                lines.Add("SENHA");
                lines.Add(CleanText(Json.String(ticket, "ticketCode") ?? Json.String(payload, "ticketCode") ?? "---", 16));
            }

            var trackUrl = CleanUrl(Json.String(payload, "trackUrl"));
            lines.Add("Acompanhe em:");
            lines.Add(trackUrl.Length == 0 ? "URL indisponivel" : trackUrl);
            var text = Encoding.ASCII.GetBytes(string.Join("\r\n", lines) + "\r\n");

            var output = new List<byte>();
            var offset = 0;
            var first = true;
            while (offset < text.Length)
            {
                var count = Math.Min(MaxTextBytesPerCommand, text.Length - offset);
                var command = new List<byte> { Esc, first ? (byte)0x14 : (byte)0x43 };
                for (var index = 0; index < count; index++) command.Add(text[offset + index]);
                AddPacket(output, command.ToArray());
                offset += count;
                first = false;
            }

            AddPacket(output, new byte[] { Esc, 0x15 });
            return output.ToArray();
        }

        private static void AddPacket(List<byte> output, byte[] command)
        {
            var count = command.Length + 2;
            var checksum = 0;
            foreach (var value in command) checksum += value;
            output.Add(Stx);
            output.Add((byte)(count & 0xff));
            output.Add((byte)((count >> 8) & 0xff));
            output.AddRange(command);
            output.Add((byte)(checksum & 0xff));
            output.Add((byte)((checksum >> 8) & 0xff));
        }

        private static string CleanText(string value, int maxLength)
        {
            if (value == null) value = "";
            value = Regex.Replace(value.Normalize(NormalizationForm.FormD), "\\p{Mn}+", "");
            value = new string(value.Where(c => c >= 0x20 && c <= 0x7e).ToArray());
            value = Regex.Replace(value, "\\s+", " ").Trim();
            return value.Length > maxLength ? value.Substring(0, maxLength) : value;
        }

        private static string CleanUrl(string value)
        {
            if (value == null) return "";
            value = new string(value.Where(c => c >= 0x20 && c != 0x7f).ToArray()).Trim();
            return value.Length > 512 ? value.Substring(0, 512) : value;
        }
    }

    internal sealed class AgentState
    {
        private readonly string directory;
        private readonly string path;
        private readonly object sync = new object();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();

        public AgentState(string directory)
        {
            this.directory = directory;
            path = Path.Combine(directory, "agent-state.bin");
            Directory.CreateDirectory(directory);
        }

        public SessionData LoadSession()
        {
            var state = Load();
            var session = state.ContainsKey("session") ? state["session"] as Dictionary<string, object> : null;
            return session == null ? null : SessionData.FromStored(session);
        }

        public void SaveSession(SessionData session)
        {
            var state = Load();
            state["session"] = session.ToDictionary();
            Save(state);
        }

        public string LoadClaimRequestId()
        {
            var state = Load();
            return state.ContainsKey("claimRequestId") ? state["claimRequestId"] as string : null;
        }

        public void SaveClaimRequestId(string requestId)
        {
            var state = Load();
            state["claimRequestId"] = requestId;
            Save(state);
        }

        public void ClearClaimRequestId()
        {
            var state = Load();
            state.Remove("claimRequestId");
            Save(state);
        }

        public ExecutionRecord LoadExecution()
        {
            var state = Load();
            return state.ContainsKey("execution") ? ExecutionRecord.From(state["execution"] as Dictionary<string, object>) : null;
        }

        public void SaveExecution(Dictionary<string, object> job, string phase, string outcome, string error)
        {
            var state = Load();
            state["execution"] = new Dictionary<string, object>
            {
                { "job", job },
                { "phase", phase },
                { "outcome", outcome },
                { "error", error }
            };
            Save(state);
        }

        public void ClearExecution()
        {
            var state = Load();
            state.Remove("execution");
            Save(state);
        }

        private Dictionary<string, object> Load()
        {
            lock (sync)
            {
                if (!File.Exists(path)) return new Dictionary<string, object>();
                var encrypted = File.ReadAllBytes(path);
                var clear = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.LocalMachine);
                var result = serializer.DeserializeObject(Encoding.UTF8.GetString(clear)) as Dictionary<string, object>;
                return result ?? new Dictionary<string, object>();
            }
        }

        private void Save(Dictionary<string, object> value)
        {
            lock (sync)
            {
                var clear = Encoding.UTF8.GetBytes(serializer.Serialize(value));
                var encrypted = ProtectedData.Protect(clear, null, DataProtectionScope.LocalMachine);
                var temporary = path + ".tmp";
                File.WriteAllBytes(temporary, encrypted);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
        }
    }

    internal sealed class ExecutionRecord
    {
        public Dictionary<string, object> Job;
        public string Phase;
        public string Outcome;
        public string Error;

        public static ExecutionRecord From(Dictionary<string, object> value)
        {
            if (value == null) return null;
            return new ExecutionRecord
            {
                Job = value.ContainsKey("job") ? value["job"] as Dictionary<string, object> : null,
                Phase = Json.String(value, "phase"),
                Outcome = Json.String(value, "outcome"),
                Error = Json.String(value, "error")
            };
        }
    }

    internal sealed class SessionData
    {
        public string SupabaseUrl;
        public string SupabaseKey;
        public string AccessToken;
        public string RefreshToken;

        public Dictionary<string, object> ToDictionary()
        {
            return new Dictionary<string, object>
            {
                { "supabaseUrl", SupabaseUrl },
                { "supabaseKey", SupabaseKey },
                { "accessToken", AccessToken },
                { "refreshToken", RefreshToken }
            };
        }

        public static SessionData FromEnrollment(Dictionary<string, object> response, Dictionary<string, object> session)
        {
            return new SessionData
            {
                SupabaseUrl = Json.String(response, "supabaseUrl"),
                SupabaseKey = Json.String(response, "supabaseKey"),
                AccessToken = Json.String(session, "access_token"),
                RefreshToken = Json.String(session, "refresh_token")
            };
        }

        public static SessionData FromStored(Dictionary<string, object> value)
        {
            return new SessionData
            {
                SupabaseUrl = Json.String(value, "supabaseUrl"),
                SupabaseKey = Json.String(value, "supabaseKey"),
                AccessToken = Json.String(value, "accessToken"),
                RefreshToken = Json.String(value, "refreshToken")
            };
        }

        public static SessionData FromRefresh(SessionData previous, Dictionary<string, object> value)
        {
            return new SessionData
            {
                SupabaseUrl = previous.SupabaseUrl,
                SupabaseKey = previous.SupabaseKey,
                AccessToken = Json.String(value, "access_token"),
                RefreshToken = Json.String(value, "refresh_token") ?? previous.RefreshToken
            };
        }
    }

    internal sealed class AgentLog
    {
        private readonly string path;
        private readonly object sync = new object();

        public AgentLog(string directory)
        {
            path = Path.Combine(directory, AgentProfile.StateLogFile);
        }

        public void Info(string message, Dictionary<string, object> details)
        {
            Write("INFO", message, details);
        }

        public void Error(string message, Dictionary<string, object> details)
        {
            Write("ERROR", message, details);
        }

        private void Write(string level, string message, Dictionary<string, object> details)
        {
            var suffix = details == null ? "" : " " + Json.Serialize(details);
            var line = DateTimeOffset.UtcNow.ToString("o") + " " + level + " " + message + suffix + Environment.NewLine;
            lock (sync)
            {
                File.AppendAllText(path, line, Encoding.UTF8);
            }
            Console.Write(line);
        }
    }

    internal static class Json
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 * 4 };

        public static string Serialize(object value)
        {
            return Serializer.Serialize(value);
        }

        public static Dictionary<string, object> ParseObject(string json)
        {
            var result = Serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (result == null) throw new InvalidOperationException("Resposta JSON inválida.");
            return result;
        }

        public static Dictionary<string, object> Object(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return null;
            return value[key] as Dictionary<string, object>;
        }

        public static List<object> Array(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return new List<object>();
            var list = value[key] as ArrayList;
            return list == null ? new List<object>() : list.Cast<object>().ToList();
        }

        public static string String(Dictionary<string, object> value, string key)
        {
            if (value == null || !value.ContainsKey(key) || value[key] == null) return null;
            return Convert.ToString(value[key], System.Globalization.CultureInfo.InvariantCulture);
        }

        public static int Int(Dictionary<string, object> value, string key)
        {
            int number;
            return int.TryParse(String(value, key), out number) ? number : Convert.ToInt32(value[key]);
        }

        public static DateTimeOffset? ParseDateTime(Dictionary<string, object> value, string key)
        {
            System.DateTimeOffset parsed;
            return System.DateTimeOffset.TryParse(String(value, key), out parsed) ? parsed : (System.DateTimeOffset?)null;
        }
    }

    internal sealed class ApiException : Exception
    {
        public int StatusCode { get; private set; }
        public string ResponseBody { get; private set; }

        public ApiException(int statusCode, string responseBody) : base("API HTTP " + statusCode)
        {
            StatusCode = statusCode;
            ResponseBody = responseBody;
        }
    }

    internal sealed class PrintException : Exception
    {
        public bool BeforeSend { get; private set; }

        public PrintException(string message, bool beforeSend, Exception inner = null) : base(message, inner)
        {
            BeforeSend = beforeSend;
        }
    }

    internal sealed class NeedsReviewException : Exception
    {
        public NeedsReviewException(string message) : base(message) { }
    }

    internal static class HttpFactory
    {
        public static HttpClient Create()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("SenhaHub-PrintAgent-x86/1.2.5");
            return client;
        }
    }
}
