package com.senhahub.bluetoothprintagent

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var apiUrlInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var kioskIdInput: EditText
    private lateinit var devicesSpinner: Spinner
    private lateinit var statusText: TextView
    private val pairedDevices = mutableListOf<BluetoothDevice>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestBluetoothPermissions()
        setContentView(buildView())
        loadPairedDevices()
        AgentCredentials(this).get("config")?.let { config ->
            apiUrlInput.setText(config.optString("apiUrl"))
            val selected=pairedDevices.indexOfFirst { it.address==config.optString("deviceAddress") }
            if(selected>=0)devicesSpinner.setSelection(selected)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::devicesSpinner.isInitialized) loadPairedDevices()
    }

    private fun buildView(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        root.addView(TextView(this).apply {
            text = "SenhaHub — Impressora Bluetooth"
            textSize = 22f
        }, match())
        root.addView(TextView(this).apply {
            text = "Use este aplicativo no tablet que ficará próximo à POS-5890A-L. Os demais tablets enviam as senhas pela fila do Açougue da Loja 2."
            setPadding(0, 18, 0, 18)
        }, match())

        apiUrlInput = input("URL do sistema", "https://senhahub.vercel.app")
        tokenInput = input("Código de pareamento (uso único)", "")
        tokenInput.inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        kioskIdInput = input("Destino definido pelo administrador", "")
        kioskIdInput.isEnabled = false
        root.addView(apiUrlInput, match())
        root.addView(tokenInput, match())
        root.addView(kioskIdInput, match())

        root.addView(TextView(this).apply { text = "Impressora Bluetooth pareada" }, match())
        devicesSpinner = Spinner(this)
        root.addView(devicesSpinner, match())
        root.addView(Button(this).apply {
            text = "Abrir configurações de Bluetooth"
            setOnClickListener { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
        }, match())

        root.addView(Button(this).apply {
            text = "Iniciar agente de impressão"
            setOnClickListener { startAgent() }
        }, match())
        root.addView(Button(this).apply {
            text = "Parar agente"
            setOnClickListener {
                AgentCredentials(this@MainActivity).setEnabled(false)
                stopService(Intent(this@MainActivity, PrinterAgentService::class.java))
                statusText.text = "Agente parado."
            }
        }, match())
        statusText = TextView(this).apply {
            text = "Pareie a impressora e mantenha este aplicativo ativo."
            setPadding(0, 18, 0, 0)
        }
        root.addView(statusText, match())
        return root
    }

    private fun startAgent() {
        if(Build.VERSION.SDK_INT>=31 && ContextCompat.checkSelfPermission(this,Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED) {
            statusText.text="Autorize o Bluetooth antes de iniciar.";return
        }
        if (pairedDevices.isEmpty()) {
            statusText.text = "Pareie a POS-5890A-L no Android antes de iniciar."
            return
        }
        if (tokenInput.text.toString().trim().length < 32 && AgentCredentials(this).get("session") == null) {
            statusText.text = "Informe o código de pareamento do administrador."
            return
        }
        val device = pairedDevices[devicesSpinner.selectedItemPosition.coerceAtLeast(0)]
        if (!apiUrlInput.text.toString().trim().startsWith("https://")) { statusText.text="A URL deve usar HTTPS.";return }
        val credentials=AgentCredentials(this)
        credentials.put("config",org.json.JSONObject()
            .put("apiUrl",apiUrlInput.text.toString().trim().trimEnd('/'))
            .put("code",tokenInput.text.toString().trim())
            .put("deviceAddress",device.address))
        credentials.setEnabled(true)
        tokenInput.text.clear()
        val intent = Intent(this, PrinterAgentService::class.java)
        ContextCompat.startForegroundService(this, intent)
        statusText.text = "Agente iniciado para ${device.name ?: device.address}."
    }

    private fun loadPairedDevices() {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null) {
            statusTextOrFallback("Este tablet não possui Bluetooth.")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ContextCompat.checkSelfPermission(this,Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED) {
            statusTextOrFallback("Autorize o acesso ao Bluetooth e tente novamente.")
            return
        }
        pairedDevices.clear()
        pairedDevices.addAll(adapter.bondedDevices.sortedBy { it.name ?: it.address })
        val labels = pairedDevices.map { "${it.name ?: "Dispositivo Bluetooth"} (${it.address})" }
        devicesSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels.ifEmpty { listOf("Nenhuma impressora pareada") })
        if (pairedDevices.isEmpty()) statusTextOrFallback("Pareie a POS-5890A-L nas configurações do Android.")
    }

    private fun requestBluetoothPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) permissions += Manifest.permission.BLUETOOTH_CONNECT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permissions += Manifest.permission.POST_NOTIFICATIONS
        if (permissions.any { !hasPermission(it) }) requestPermissions(permissions.toTypedArray(), REQUEST_PERMISSIONS)
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun statusTextOrFallback(message: String) {
        if (::statusText.isInitialized) statusText.text = message
    }

    private fun input(label: String, value: String): EditText = EditText(this).apply {
        hint = label
        setText(value)
        layoutParams = match()
    }

    private fun match(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = 12 }

    companion object {
        private const val REQUEST_PERMISSIONS = 1001
    }
}
