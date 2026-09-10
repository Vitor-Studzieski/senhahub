package com.senhahub.bluetoothprintagent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
class BootReceiver: BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        if(intent.action!=Intent.ACTION_BOOT_COMPLETED)return
        if(!AgentCredentials(context).enabled())return
        // Vendor/user background restrictions may forbid startup; foreground UI remains recovery path.
        runCatching{ContextCompat.startForegroundService(context,Intent(context,PrinterAgentService::class.java))}
    }
}
