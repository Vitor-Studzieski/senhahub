package com.senhahub.bluetoothprintagent

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AgentHttpError(val status: Int) : IOException("API HTTP $status")
class AgentNetwork(private val credentials: AgentCredentials, val apiUrl: String) {
    private val sessionMutex=Mutex()
    val client=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).build()
    suspend fun post(url: String, body: JSONObject, token: String?=null, key: String?=null): JSONObject {
        require(url.startsWith("https://")) { "HTTPS obrigatório" }
        val builder=Request.Builder().url(url).post(body.toString().toRequestBody("application/json".toMediaType())).header("x-print-agent-version","android/2.0.0")
        token?.let { builder.header("Authorization","Bearer $it") }; key?.let { builder.header("apikey",it) }
        return suspendCancellableCoroutine { cont ->
            val call=client.newCall(builder.build());cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object: Callback {
                override fun onFailure(call: Call,e: IOException) { if(cont.isActive)cont.resumeWithException(e) }
                override fun onResponse(call: Call,response: Response) { response.use {
                    try { if(!it.isSuccessful)throw AgentHttpError(it.code);val data=JSONObject(it.body?.string() ?: "{}");if(cont.isActive)cont.resume(data) }
                    catch(e: Exception){if(cont.isActive)cont.resumeWithException(e)}
                } }
            })
        }
    }
    suspend fun session(): JSONObject = sessionMutex.withLock {
        var saved=credentials.get("session")
        if(saved==null) {
            val config=credentials.get("config") ?: error("Configuração ausente")
            val enrolled=post("$apiUrl/api/print/v2/enroll",JSONObject().put("code",config.getString("code")))
            saved=enrolled.getJSONObject("session")
            credentials.put("connection",JSONObject().put("url",enrolled.getString("supabaseUrl")).put("key",enrolled.getString("supabaseKey")))
            credentials.put("session",saved)
            config.remove("code");credentials.put("config",config)
        }
        if(saved.optLong("expires_at")*1000 < System.currentTimeMillis()+60000) {
            val connection=credentials.get("connection") ?: error("Conexão ausente")
            saved=post(connection.getString("url")+"/auth/v1/token?grant_type=refresh_token",JSONObject().put("refresh_token",saved.getString("refresh_token")),key=connection.getString("key"))
            if(!saved.has("expires_at"))saved.put("expires_at",System.currentTimeMillis()/1000+saved.optLong("expires_in",3600))
            credentials.put("session",saved)
        }
        saved
    }
    suspend fun command(name: String,body: JSONObject=JSONObject()): JSONObject = post("$apiUrl/api/print/v2/$name",body,session().getString("access_token"))
    fun close(){client.dispatcher.cancelAll();client.connectionPool.evictAll()}
}

/** Supabase's documented Phoenix JSON protocol v1, receive-only private Broadcast. */
class AgentRealtime(private val network: AgentNetwork, private val bootstrap: JSONObject, private val onReady: ()->Unit, private val onClosed: ()->Unit) : WebSocketListener() {
    private var socket: WebSocket?=null
    private val topic="realtime:"+bootstrap.getString("topic")
    private var token=""
    private var nextRef=1
    @Volatile var subscribed=false
    @Volatile private var stopped=false
    private var lastReply=System.currentTimeMillis()
    fun connect(accessToken: String) {
        token=accessToken
        val url=bootstrap.getString("supabaseUrl").replaceFirst("https://","wss://")+"/realtime/v1/websocket?vsn=1.0.0&apikey="+java.net.URLEncoder.encode(bootstrap.getString("supabaseKey"),"UTF-8")
        socket=network.client.newWebSocket(Request.Builder().url(url).build(),this)
    }
    private fun send(event: String,payload: JSONObject,to: String=topic) {
        socket?.send(JSONObject().put("topic",to).put("event",event).put("payload",payload).put("ref",(nextRef++).toString()).toString())
    }
    override fun onOpen(webSocket: WebSocket,response: Response) {
        socket=webSocket
        send("phx_join",JSONObject().put("access_token",token).put("config",JSONObject().put("private",true).put("broadcast",JSONObject().put("ack",false).put("self",false)).put("presence",JSONObject().put("enabled",false))))
    }
    override fun onMessage(webSocket: WebSocket,text: String) {
        runCatching {
            val data=JSONObject(text);val event=data.optString("event");val payload=data.optJSONObject("payload") ?: JSONObject()
            if(event=="phx_reply"&&payload.optString("status")=="ok") {
                lastReply=System.currentTimeMillis()
                if(data.optString("ref")=="1"&&data.optString("topic")==topic){subscribed=true;onReady()}
            } else if(event=="broadcast"&&data.optString("topic")==topic&&payload.optString("event")=="print_job.available")onReady()
            else if(event in listOf("phx_error","phx_close")||(event=="phx_reply"&&payload.optString("status")=="error"))fail()
        }.onFailure { fail() }
    }
    fun heartbeat(accessToken: String) {
        if(System.currentTimeMillis()-lastReply>60000){fail();return}
        if(accessToken!=token){token=accessToken;send("access_token",JSONObject().put("access_token",token));onReady()}
        send("heartbeat",JSONObject(),"phoenix")
    }
    private fun fail(){subscribed=false;socket?.cancel();if(!stopped)onClosed()}
    override fun onFailure(webSocket: WebSocket,t: Throwable,response: Response?) { if(!stopped){subscribed=false;onClosed()} }
    override fun onClosed(webSocket: WebSocket,code: Int,reason: String) { if(!stopped){subscribed=false;onClosed()} }
    fun close(){stopped=true;subscribed=false;socket?.cancel()}
}
