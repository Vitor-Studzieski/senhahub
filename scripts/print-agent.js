const { buildTicketReceipt } = require("../server/kiosk/escpos-receipt");
const { SerialPrinter } = require("./print-agent/serial-printer");
const { PrintRealtimeSignal } = require("./print-agent/realtime");
const {
  AgentLogger,
  loadAgentEnvironment,
  readAgentConfiguration
} = require("./print-agent/runtime");

const argumentsList = new Set(process.argv.slice(2));

if (require.main === module) {
  loadAgentEnvironment();
  main().catch((error) => {
    process.stderr.write(`Falha ao iniciar o agente: ${error.message}\n`);
    process.exitCode = 1;
  });
}

async function main() {
  if (argumentsList.has('--list-ports')) { console.log(JSON.stringify(await SerialPrinter.list(),null,2)); return; }
  const config=readAgentConfiguration();
  const {DurableStore,acquirePrinterLock}=require('./print-agent/durable-store');
  const {openDeviceSession,deviceApi}=require('./print-agent/session');
  const {PrintConsumer}=require('./print-agent/consumer');
  const {PrintSseSignal}=require('./print-agent/realtime');
  const release=await acquirePrinterLock(config.printerPort);
  const store=new DurableStore(config.stateDir),logger=new AgentLogger(config.stateDir),printer=new SerialPrinter(config);
  const controller=new AbortController();
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let session,realtime,consumer;
  try {
    if(argumentsList.has('--test-printer')) {
      await printer.print(buildTicketReceipt({ticketCode:'T001',sectorName:'Teste',issuedAt:new Date().toISOString(),paperWidthMm:80}));return;
    }
    let api,bootstrap,failures=0;
    while(!controller.signal.aborted) {
      try {
        if(!session)session=await openDeviceSession(config,store,controller.signal);
        api=deviceApi(config,session,controller.signal);bootstrap=await api('bootstrap');break;
      } catch {
        logger.error('Autenticacao/conexao indisponivel; configuracao e journal preservados.');
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
      ?new PrintSseSignal({apiUrl:config.apiUrl,token:session.token,onSignal,signal:controller.signal})
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
