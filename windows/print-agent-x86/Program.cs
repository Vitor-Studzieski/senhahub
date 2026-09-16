using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace SenhaHub.PrintAgent.X86
{
    internal static class Program
    {
        private static readonly CancellationTokenSource Stop = new CancellationTokenSource();

        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
            {
                e.Cancel = true;
                Stop.Cancel();
            };

            try
            {
                var config = AgentConfig.Load(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "agent.env"));
                if (args.Any(a => string.Equals(a, "--service", StringComparison.OrdinalIgnoreCase)) || !Environment.UserInteractive)
                {
                    ServiceBase.Run(new PrintAgentService(config));
                    return 0;
                }

                if (args.Any(a => string.Equals(a, "--list-ports", StringComparison.OrdinalIgnoreCase)))
                {
                    foreach (var port in SerialPort.GetPortNames().OrderBy(p => p)) Console.WriteLine(port);
                    return 0;
                }

                if (args.Any(a => string.Equals(a, "--test-printer", StringComparison.OrdinalIgnoreCase)))
                {
                    var printer = new SerialPrinter(config);
                    printer.Print(ReceiptBuilder.Build(TestPayload()), Stop.Token);
                    Console.WriteLine("Cupom de diagnóstico enviado para " + config.PrinterPort + ".");
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
                Console.Error.WriteLine("Falha ao iniciar o agente x86: " + error.Message);
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
            var printer = new SerialPrinter(config);
            var worker = new PrintWorker(config, api, printer, state, log, cancellationToken);

            log.Info("Agente x86 iniciado.", new Dictionary<string, object>
            {
                { "version", "x86/1.0.0" },
                { "port", config.PrinterPort },
                { "pollMs", config.PollIntervalMs }
            });

            var failures = 0;
            while (!Stop.IsCancellationRequested)
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

            log.Info("Agente x86 encerrado.", null);
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
        private readonly AgentConfig config;
        private readonly CancellationTokenSource stop = new CancellationTokenSource();
        private Task workerTask;

        public PrintAgentService(AgentConfig config)
        {
            this.config = config;
            ServiceName = "SenhaHubPrintAgentX86";
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            workerTask = Task.Run(() => Program.RunServiceAsync(config, stop.Token));
        }

        protected override void OnStop()
        {
            stop.Cancel();
            if (workerTask != null)
            {
                try { workerTask.Wait(TimeSpan.FromSeconds(20)); }
                catch (AggregateException) { }
            }
        }

        protected override void OnShutdown()
        {
            OnStop();
            base.OnShutdown();
        }
    }

    internal sealed class AgentConfig
    {
        public string ApiUrl;
        public string EnrollmentCode;
        public string LocalToken;
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
                PrinterPort = Get(values, "KIOSK_PRINTER_PORT", "COM4"),
                BaudRate = PositiveInt(Get(values, "PRINT_SERIAL_BAUD_RATE", "115200"), 115200),
                DataBits = Get(values, "PRINT_SERIAL_DATA_BITS", "8") == "7" ? 7 : 8,
                StopBits = Get(values, "PRINT_SERIAL_STOP_BITS", "1") == "2" ? StopBits.Two : StopBits.One,
                Parity = ParseParity(Get(values, "PRINT_SERIAL_PARITY", "none")),
                RtsCts = ParseFlag(Get(values, "PRINT_SERIAL_RTSCTS", "0")),
                PollIntervalMs = Math.Max(2000, PositiveInt(Get(values, "PRINT_POLL_INTERVAL_MS", "5000"), 5000)),
                StateDirectory = Get(values, "PRINT_AGENT_STATE_DIR", "data\\print-agent-x86")
            };

            if (!config.ApiUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !IsLoopback(config.ApiUrl))
                throw new InvalidOperationException("PRINT_API_URL deve usar HTTPS.");
            if (config.EnrollmentCode.Length == 0 && config.LocalToken.Length == 0)
                throw new InvalidOperationException("Informe PRINT_ENROLLMENT_CODE no primeiro pareamento.");
            if (config.StateDirectory.Length == 0) config.StateDirectory = "data\\print-agent-x86";
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
                message.Headers.Add("x-print-agent-version", "windows-x86/1.0.0");
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
        private readonly SerialPrinter printer;
        private readonly AgentState state;
        private readonly AgentLog log;
        private readonly CancellationToken stop;
        private bool needsReview;

        public PrintWorker(AgentConfig config, PrintApi api, SerialPrinter printer, AgentState state, AgentLog log, CancellationToken stop)
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
            var started = await api.CommandAsync("start", Ownership(job));
            var startedJob = Json.Object(started, "job");
            if (startedJob == null || Json.String(startedJob, "status") != "printing") throw new InvalidOperationException("O servidor não aceitou o início da impressão.");
            var expiresAt = Json.ParseDateTime(startedJob, "lease_expires_at");
            if (expiresAt.HasValue && expiresAt.Value < DateTimeOffset.UtcNow.AddSeconds(15)) throw new InvalidOperationException("Lease muito próximo do vencimento.");

            state.SaveExecution(job, "writing", null, null);
            string outcome = "printed";
            string errorMessage = null;
            try
            {
                printer.Print(receipt, stop);
            }
            catch (PrintException error)
            {
                outcome = error.BeforeSend ? "before_send" : "unknown";
                errorMessage = error.BeforeSend ? "Impressora indisponível antes do envio." : "Resultado físico incerto; impressão não será repetida automaticamente.";
            }

            state.SaveExecution(job, "result", outcome, errorMessage);
            await FinishAsync(job, outcome, errorMessage);
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
    }

    internal sealed class SerialPrinter
    {
        private readonly AgentConfig config;

        public SerialPrinter(AgentConfig config)
        {
            this.config = config;
        }

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

    internal static class ReceiptBuilder
    {
        private const byte Esc = 0x1b;
        private const byte Gs = 0x1d;
        private const byte Lf = 0x0a;

        public static byte[] Build(Dictionary<string, object> payload)
        {
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
            path = Path.Combine(directory, "print-agent-x86.log");
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
            client.DefaultRequestHeaders.UserAgent.ParseAdd("SenhaHub-PrintAgent-x86/1.0.0");
            return client;
        }
    }
}
