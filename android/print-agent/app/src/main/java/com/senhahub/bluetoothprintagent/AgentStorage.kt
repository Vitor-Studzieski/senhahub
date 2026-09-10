package com.senhahub.bluetoothprintagent

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Synchronous encrypted persistence; no token is kept in an Intent or plaintext preferences. */
class AgentCredentials(private val context: Context) {
    private val prefs = context.getSharedPreferences("print-agent-v2-secure", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("senhahub-print-v2", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("senhahub-print-v2", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun put(name: String, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val bytes = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "Falha ao persistir credenciais" }
    }
    @Synchronized fun get(name: String): JSONObject? {
        val text = prefs.getString(name, null) ?: return null
        val bytes = Base64.decode(text, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12))) }
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8))
    }
    fun enabled(): Boolean = prefs.getBoolean("enabled", false)
    fun setEnabled(value: Boolean) { check(prefs.edit().putBoolean("enabled", value).commit()) }
}

/** SQLite FULL + transactions is used directly; no asynchronous SharedPreferences journal. */
class AgentJournal(context: Context) : SQLiteOpenHelper(context, "print-agent-v2.sqlite", null, 1) {
    override fun onConfigure(db: SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE executions(lease_id TEXT PRIMARY KEY,job TEXT NOT NULL,phase TEXT NOT NULL,outcome TEXT,error TEXT,acknowledged INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Journal migration required") }
    fun save(job: JSONObject, phase: String, outcome: String? = null, error: String? = null) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val values = ContentValues().apply {
                put("lease_id",job.getString("lease_id"));put("job",job.toString());put("phase",phase)
                put("outcome",outcome);put("error",error)
            }
            val updated=db.update("executions",values,"lease_id=?",arrayOf(job.getString("lease_id")))
            if(updated==0) check(db.insertOrThrow("executions",null,values)>0)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    data class Entry(val job: JSONObject, val phase: String, val outcome: String?, val error: String?)
    fun pending(): List<Entry> = readableDatabase.rawQuery("SELECT job,phase,outcome,error FROM executions WHERE acknowledged=0",null).use { c ->
        buildList { while(c.moveToNext()) add(Entry(JSONObject(c.getString(0)),c.getString(1),c.getString(2),c.getString(3))) }
    }
    fun acknowledge(job: JSONObject) { writableDatabase.execSQL("UPDATE executions SET acknowledged=1 WHERE lease_id=?",arrayOf(job.getString("lease_id"))) }
    fun claimId(): String {
        readableDatabase.rawQuery("SELECT value FROM state WHERE key='claim'",null).use { if(it.moveToFirst()) return it.getString(0) }
        val id=java.util.UUID.randomUUID().toString()
        writableDatabase.execSQL("INSERT INTO state VALUES('claim',?)",arrayOf(id));return id
    }
    fun clearClaim() { writableDatabase.execSQL("DELETE FROM state WHERE key='claim'") }
}
