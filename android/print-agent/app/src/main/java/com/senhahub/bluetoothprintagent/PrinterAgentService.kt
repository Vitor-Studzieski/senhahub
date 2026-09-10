package com.senhahub.bluetoothprintagent

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.random.Random

class PrinterAgentService : Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val wakes=Channel<Unit>(Channel.CONFLATED)
    private val reconnects=Channel<Unit>(Channel.CONFLATED)
    private var loop: Job?=null
    private var network: AgentNetwork?=null
    private var realtime: AgentRealtime?=null
    private var printer: BluetoothPrinter?=null
    private lateinit var journal: AgentJournal
    private var nextAttempt=Long.MAX_VALUE
    private var needsReview=false

    override fun onCreate(){super.onCreate();journal=AgentJournal(this);getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Impressão SenhaHub",NotificationManager.IMPORTANCE_LOW))}
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        val notification=notification("Conectando agente")
        if(Build.VERSION.SDK_INT>=29) startForeground(ID,notification,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(ID,notification)
        // A duplicate start must not replace a live writer or start a second consumer.
        if(loop?.isActive==true)return START_STICKY
        val credentials=AgentCredentials(this)
        if(!credentials.enabled()){stopSelf();return START_NOT_STICKY}
        loop=scope.launch {
            try {runAgent(credentials)} catch(e: CancellationException){throw e} catch(e: Exception){update("Configuração ou sessão indisponível. Abra o aplicativo.")}
        }
        return START_STICKY
    }
    override fun onDestroy(){realtime?.close();network?.close();printer?.close();loop?.cancel();scope.cancel();super.onDestroy()}
    override fun onBind(intent: Intent?): IBinder?=null

    private suspend fun runAgent(credentials: AgentCredentials)=coroutineScope {
        val config=credentials.get("config") ?: error("Configuração ausente")
        val api=AgentNetwork(credentials,config.getString("apiUrl"));network=api
        val physical=BluetoothPrinter(this@PrinterAgentService,config.getString("deviceAddress"));printer=physical
        var bootstrap: JSONObject
        var failures=0
        while(true){try{bootstrap=api.command("bootstrap");break}catch(e: CancellationException){throw e}catch(e: Exception){update("Sem conexão. Configuração preservada.");delay(backoff(failures++))}}
        require(bootstrap.getString("transport")=="supabase") { "Transporte Android não configurado" }
        val reconciliation=bootstrap.optLong("reconciliationMs",600000).coerceAtLeast(60000)
        val connectionJob=launch {
            if(!bootstrap.optBoolean("realtimeEnabled",true)){wakes.trySend(Unit);return@launch}
            var retries=0
            while(isActive) {
                try {
                    realtime?.close()
                    val connection=AgentRealtime(api,bootstrap,{wakes.trySend(Unit)},{reconnects.trySend(Unit)})
                    realtime=connection;connection.connect(api.session().getString("access_token"))
                    while(isActive) {
                        if(withTimeoutOrNull(25000){reconnects.receive()}!=null)break
                        connection.heartbeat(api.session().getString("access_token"))
                        if(connection.subscribed)retries=0
                    }
                }catch(e: CancellationException){throw e}catch(e: Exception){update("Reconectando canal privado")}
                realtime?.close();delay(backoff(retries++))
            }
        }
        try {
            failures=0
            while(isActive) {
                // First synchronization waits for the confirmed subscription. The rare
                // watchdog also covers a lost Broadcast while the socket stays connected.
                withTimeoutOrNull(minOf(reconciliation,(nextAttempt-System.currentTimeMillis()).coerceAtLeast(1000))){wakes.receive()}
                nextAttempt=Long.MAX_VALUE
                try {
                    recover(api)
                    if(needsReview) continue
                    while(isActive) {
                        val result=api.command("claim",JSONObject().put("requestId",journal.claimId()))
                        journal.clearClaim();rememberRetry(result)
                        val job=result.optJSONObject("job") ?: break
                        if(job.getString("status")!="leased")break
                        if(!process(api,physical,job))break
                    }
                    failures=0
                    if(!needsReview) update("Aguardando eventos de impressão")
                }catch(e: CancellationException){throw e}catch(e: Exception){
                    update(if(e is AgentHttpError&&e.status in listOf(401,403))"Dispositivo sem autorização; journal preservado" else "Falha de comunicação; confirmação preservada")
                    delay(backoff(failures++));wakes.trySend(Unit)
                }
            }
        } finally {connectionJob.cancelAndJoin();realtime?.close();physical.close();api.close();journal.close()}
    }
    private fun owner(job: JSONObject)=JSONObject().put("jobId",job.getString("id")).put("leaseId",job.getString("lease_id")).put("attemptVersion",job.getInt("attempt_version"))
    private suspend fun confirm(api: AgentNetwork,job: JSONObject,outcome: String,error: String?=null): JSONObject {
        val result=api.command("finish",owner(job).put("outcome",outcome).put("error",error ?: JSONObject.NULL))
        journal.acknowledge(job);rememberRetry(result)
        if(result.optJSONObject("job")?.optString("status")=="needs_review") needsReview=true
        return result
    }
    private fun rememberRetry(result: JSONObject) {
        val value=result.optString("nextAttemptAt")
        runCatching { java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()?.let { if(it>System.currentTimeMillis())nextAttempt=minOf(nextAttempt,it) }
    }
    private suspend fun recover(api: AgentNetwork) {
        needsReview=false
        for(entry in journal.pending()) {
            val outcome=entry.outcome ?: if(entry.phase=="leased")"before_send" else "unknown"
            journal.save(entry.job,"result",outcome,entry.error ?: "Recovered after interruption")
            try { confirm(api,entry.job,outcome,entry.error) }
            catch(e: AgentHttpError) {
                if(e.status==409){needsReview=true;update("Conflito no journal: intervenção necessária");return}
                throw e
            }
        }
        val result=api.command("recover");rememberRetry(result)
        val job=result.optJSONObject("job") ?: return
        val status=job.getString("status")
        if(status=="needs_review"){needsReview=true;update("Resultado incerto: intervenção necessária");return}
        val outcome=if(status=="leased")"before_send" else "unknown"
        journal.save(job,"result",outcome,"Execution recovered without local result")
        confirm(api,job,outcome,"Execution recovered without local result")
    }
    private suspend fun process(api: AgentNetwork,physical: BluetoothPrinter,job: JSONObject): Boolean {
        journal.save(job,"leased")
        val bytes=try {
            val payload=job.getJSONObject("payload");require(payload.optString("ticketCode").isNotBlank());buildReceipt(payload)
        }catch(e: Exception){journal.save(job,"result","before_send","Invalid receipt");confirm(api,job,"before_send","Invalid receipt");return true}
        journal.save(job,"starting")
        val started=api.command("start",owner(job)).getJSONObject("job")
        check(started.getString("status")=="printing")
        check(java.time.OffsetDateTime.parse(started.getString("lease_expires_at")).toInstant().toEpochMilli()-System.currentTimeMillis()>15000)
        journal.save(job,"writing");update("Enviando cupom à impressora")
        var outcome="printed"
        try {withTimeout(30000){physical.print(bytes)}}
        catch(e: TimeoutCancellationException){outcome="unknown"}
        catch(e: CancellationException){throw e}
        catch(e: PrintTransportError){outcome=if(e.beforeSend)"before_send" else "unknown"}
        catch(e: Exception){outcome="unknown"}
        // HTTP acknowledgement is deliberately outside the physical send's try/catch.
        journal.save(job,"result",outcome)
        confirm(api,job,outcome)
        if(outcome=="unknown"){needsReview=true;update("Resultado incerto: intervenção necessária")}
        return outcome!="unknown"
    }
    private fun backoff(attempt: Int): Long=(minOf(300000L,15000L*(1L shl minOf(attempt,4)))*Random.nextDouble(0.75,1.25)).toLong()
    private fun update(message: String){getSystemService(NotificationManager::class.java).notify(ID,notification(message))}
    private fun notification(message: String): Notification=NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentTitle("SenhaHub Impressora").setContentText(message).setOngoing(true).build()
    companion object { private const val CHANNEL="senhahub-print-agent";private const val ID=5890 }
}

private class PrintTransportError(val beforeSend: Boolean,cause: Throwable): IOException("Falha no transporte da impressora",cause)
private class BluetoothPrinter(private val service: Service,private val address: String) {
    private val worker=Executors.newSingleThreadExecutor()
    @Volatile private var socket: BluetoothSocket?=null
    @SuppressLint("MissingPermission")
    suspend fun print(bytes: ByteArray): Unit=suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { runCatching{socket?.close()} }
        worker.execute {
            var beforeSend=true
            try {
                check(cont.isActive)
                if(Build.VERSION.SDK_INT>=31&&ContextCompat.checkSelfPermission(service,Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)throw IOException("Bluetooth não autorizado")
                val adapter=service.getSystemService(BluetoothManager::class.java)?.adapter ?: throw IOException("Bluetooth indisponível")
                val current=adapter.getRemoteDevice(address).createRfcommSocketToServiceRecord(UUID.fromString("00001101-0000-1000-8000-00805F9B34FB"))
                socket=current
                check(cont.isActive);current.connect();check(cont.isActive)
                beforeSend=false;current.outputStream.write(bytes);current.outputStream.flush()
                if(cont.isActive)cont.resume(Unit)
            }catch(e: Exception){if(cont.isActive)cont.resumeWithException(PrintTransportError(beforeSend,e))}
            finally{runCatching{socket?.close()};socket=null}
        }
    }
    fun close(){runCatching{socket?.close()};worker.shutdownNow()}
}
private fun buildReceipt(payload: JSONObject): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    out.write(byteArrayOf(0x1b, 0x40))
    out.write(byteArrayOf(0x1b, 0x61, 0x01))
    out.write(byteArrayOf(0x1b, 0x45, 0x01))
    out.write(byteArrayOf(0x1d, 0x21, 0x01))
    line(out, "SUPERMERCADO POMPEIA")
    out.write(byteArrayOf(0x1d, 0x21, 0x00))
    line(out, "SenhaHub")

    val tickets = payload.optJSONArray("tickets")
    if (tickets != null && tickets.length() > 0) {
        for (index in 0 until minOf(tickets.length(), 12)) {
            val ticket = tickets.optJSONObject(index) ?: continue
            ticketBlock(out, ticket.optString("sectorName", payload.optString("sectorName", "SETOR")), ticket.optString("ticketCode", payload.optString("ticketCode", "---")))
        }
    } else {
        ticketBlock(out, payload.optString("sectorName", "SETOR"), payload.optString("ticketCode", "---"))
    }
    out.write(byteArrayOf(0x1b, 0x64, 0x01))
    qrCode(out, payload.optString("trackUrl"))
    line(out, "Escaneie o QR Code para acompanhar")
    out.write(byteArrayOf(0x1b, 0x64, 0x03))
    out.write(byteArrayOf(0x1d, 0x56, 0x42, 0x04))
    return out.toByteArray()
}

private fun ticketBlock(out: java.io.ByteArrayOutputStream, sector: String, code: String) {
    line(out, sector.uppercase(Locale.ROOT))
    out.write(byteArrayOf(0x1b, 0x45, 0x01))
    line(out, "SENHA")
    out.write(byteArrayOf(0x1d, 0x21, 0x33))
    line(out, code)
    out.write(byteArrayOf(0x1d, 0x21, 0x00))
    out.write(byteArrayOf(0x1b, 0x45, 0x00))
}

private fun qrCode(out: java.io.ByteArrayOutputStream, value: String) {
    if (value.isBlank()) {
        line(out, "QR Code indisponivel")
        return
    }
    val data = value.toByteArray(StandardCharsets.UTF_8)
    val length = data.size + 3
    out.write(byteArrayOf(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00))
    out.write(byteArrayOf(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06))
    out.write(byteArrayOf(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31))
    out.write(byteArrayOf(0x1d, 0x28, 0x6b, (length and 0xff).toByte(), ((length shr 8) and 0xff).toByte(), 0x31, 0x50, 0x30))
    out.write(data)
    out.write(byteArrayOf(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30))
}

private fun line(out: java.io.ByteArrayOutputStream, value: String) {
    out.write(cleanAscii(value).toByteArray(StandardCharsets.US_ASCII))
    out.write(0x0a)
}

private fun cleanAscii(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
    .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
    .replace("[^\\x20-\\x7e]".toRegex(), "")
    .replace("\\s+".toRegex(), " ")
    .trim()
    .take(160)
