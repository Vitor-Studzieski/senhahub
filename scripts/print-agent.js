const { buildTicketReceipt } = require("../server/kiosk/escpos-receipt");
const { PrintRealtimeSignal } = require("./print-agent/realtime");
const fs = require("node:fs");
const path = require("node:path");
const {
  AgentLogger,
  loadAgentEnvironment,
  readAgentConfiguration,
  redactText
} = require("./print-agent/runtime");

const argumentsList = new Set(process.argv.slice(2));

if (require.main === module) {
  let logger;
  try {
    if (argumentsList.has("--diagnose")) {
      const { main: runDiagnostic } = require("./print-agent/diagnostic");
      runDiagnostic(process.argv.slice(2).filter((argument) => argument !== "--diagnose"))
        .catch((error) => {
          process.stderr.write(`Não foi possível concluir o diagnóstico: ${redactText(error?.message || error)}\n`);
          process.exitCode = 1;
        });
    } else {
      loadAgentEnvironment();
    }
    if (!argumentsList.has("--diagnose") && !argumentsList.has("--list-ports")) {
      const stateDir = path.resolve(process.env.PRINT_AGENT_STATE_DIR || path.join(process.cwd(), "data", "print-agent"));
      logger = new AgentLogger(stateDir);
    }
    if (!argumentsList.has("--diagnose")) main(logger).catch((error) => reportStartupFailure(error, logger));
  } catch (error) {
    reportStartupFailure(error, logger);
  }
}

async function main(logger) {
  if (argumentsList.has('--list-ports')) {
    const { SerialPrinter } = require("./print-agent/serial-printer");
    console.log(JSON.stringify(await SerialPrinter.list(), null, 2));
    return;
  }
  const config=readAgentConfiguration();
  logger = logger || new AgentLogger(config.stateDir);
  const { SerialPrinter } = require("./print-agent/serial-printer");
  const printer=new SerialPrinter(config);
  if(argumentsList.has('--test-printer')) {
    logger.info('Iniciando teste físico da impressora.', { port: config.printerPort, baudRate: config.baudRate });
    await printer.print(buildTicketReceipt({ticketCode:'T001',sectorName:'Teste',issuedAt:new Date().toISOString(),paperWidthMm:80}));
    logger.info('Cupom de diagnóstico enviado.', { port: config.printerPort });
    return;
  }
  const {DurableStore,acquirePrinterLock}=require('./print-agent/durable-store');
  const {openDeviceSession,deviceApi}=require('./print-agent/session');
  const {PrintConsumer}=require('./print-agent/consumer');
  const {PrintSseSignal}=require('./print-agent/realtime');
  const release=await acquirePrinterLock(config.printerPort);
  const store=new DurableStore(config.stateDir);
  const controller=new AbortController();
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let session,realtime,consumer;
  try {
    let api,bootstrap,failures=0;
    while(!controller.signal.aborted) {
      try {
        if(!session)session=await openDeviceSession(config,store,controller.signal);
        api=deviceApi(config,session,controller.signal);bootstrap=await api('bootstrap');break;
      } catch(error) {
        logger.error('Autenticação/conexão indisponível; configuração e journal preservados.', errorDetails(error, failures + 1));
        await require('node:timers/promises').setTimeout(Math.min(300000,15000*2**Math.min(failures++,4))*(0.75+Math.random()/2),null,{signal:controller.signal}).catch(()=>{});
      }
    }
    if(controller.signal.aborted)return;
    if(argumentsList.has('--simulate')) {
      if(bootstrap.device.capabilities?.simulator!==true)throw new Error('Simulacao exige dispositivo cadastrado exclusivamente para teste.');
      printer.print=async()=>logger.info('Envio simulado em destino de teste.');
    }
    store.set('bootstrap',bootstrap);
    consumer=new PrintConsumer({api,store,printer,logger,signal:controller.signal,reconciliationMs:config.reconciliationMs||bootstrap.reconciliationMs});
    const onSignal=()=>consumer.wake();
    realtime=bootstrap.transport==='sse'
      ?new PrintSseSignal({apiUrl:config.apiUrl,token:session.token,onSignal,signal:controller.signal,logger})
      :new PrintRealtimeSignal({client:session.client,topic:bootstrap.topic,onSignal,logger});
    logger.info('Agente v2 iniciado.',{protocol:2,version:'2.0.0',deviceId:bootstrap.device.id,printerId:bootstrap.device.printerId});
    if(config.realtimeEnabled && bootstrap.realtimeEnabled !== false)await realtime.start();
    else {logger.info('Recuperacao limitada ativada por configuracao.');consumer.wake();}
    // Subscription confirmation starts recovery; safety timer covers a lost Broadcast
    // or a transport that remains unavailable. No startup claim before subscription.
    consumer.arm(consumer.reconciliationMs);
    await new Promise(resolve=>{if(controller.signal.aborted)resolve();else controller.signal.addEventListener('abort',resolve,{once:true});});
  } finally {
    controller.abort();await realtime?.stop();await consumer?.stop();await session?.close();store.close();await release();
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}

function reportStartupFailure(error, logger) {
  const message = redactText(error?.message || error);
  try {
    if (logger) {
      const details = errorDetails(error);
      if (argumentsList.has('--test-printer')) {
        logger.error('Falha no teste físico da impressora.', details);
      } else {
        logger.error('Falha ao iniciar o agente.', details);
        fs.appendFileSync(
          path.join(logger.directory, 'agent-startup.log'),
          `${new Date().toISOString()} ${JSON.stringify({ ...details, stack: redactText(error?.stack || '') })}\n`,
          { encoding: 'utf8', mode: 0o600 }
        );
      }
    }
    else process.stderr.write(`Falha ao iniciar o agente: ${message}\n`);
  } catch (loggingError) {
    process.stderr.write(`Falha ao iniciar o agente: ${message}\n`);
    process.stderr.write(`Falha ao gravar o diagnóstico: ${redactText(loggingError?.message || loggingError)}\n`);
  }
  process.exitCode = 1;
}

function errorDetails(error, attempt) {
  return {
    name: String(error?.name || 'Error'),
    code: error?.code || undefined,
    status: Number(error?.status) || 0,
    message: redactText(error?.message || error),
    ...(Number.isInteger(attempt) ? { attempt } : {})
  };
}

function receiptPayload(job, logger) {
  const payload = { ...(job?.payload || {}) };
  if (validDate(payload.issuedAt)) return payload;
  const fallback = [job?.createdAt, job?.claimedAt]
    .find(validDate);
  if (!fallback) {
    throw new Error("Horario de emissao invalido no trabalho de impressao.");
  }
  payload.issuedAt = fallback;
  logger.info("Horario invalido no trabalho; usando horario de criacao como reserva.", {
    jobId: job?.id,
    ticketCode: payload.ticketCode
  });
  return payload;
}

function assertPrintableJob(job) {
  if (!job || !String(job.id || "").trim()) {
    throw new Error("Trabalho de impressao invalido recebido da API: ID ausente.");
  }
  if (!String(job.payload?.ticketCode || "").trim()) {
    throw new Error("Trabalho de impressao invalido recebido da API: senha ausente.");
  }
}

function validDate(value) { return Number.isFinite(new Date(value).getTime()); }
module.exports = { main, receiptPayload, assertPrintableJob };
