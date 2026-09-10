package com.senhahub.bluetoothprintagent
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.json.JSONObject
import java.util.UUID
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class AgentJournalTest {
    @Test fun restartRetainsPhysicalSuccessUntilAcknowledged() {
        val context=RuntimeEnvironment.getApplication()
        val job=JSONObject().put("id",UUID.randomUUID().toString()).put("lease_id",UUID.randomUUID().toString()).put("attempt_version",1)
        withJournal(context) { it.save(job,"writing");it.save(job,"result","printed") }
        withJournal(context) {
            val pending=it.pending().single();assertEquals("printed",pending.outcome)
            assertEquals(job.getString("lease_id"),pending.job.getString("lease_id"));it.acknowledge(job)
        }
        withJournal(context) { assertTrue(it.pending().isEmpty()) }
    }
    @Test fun interruptionBeforeResultRetainsIntentAndClaimRequest() {
        val context=RuntimeEnvironment.getApplication()
        val job=JSONObject().put("lease_id",UUID.randomUUID().toString())
        val request=withJournal(context) { it.save(job,"writing");it.claimId() }
        withJournal(context) {
            assertEquals("writing",it.pending().single().phase);assertNull(it.pending().single().outcome)
            assertEquals(request,it.claimId());it.clearClaim();assertNotEquals(request,it.claimId())
        }
    }
}

private fun <T> withJournal(context: android.content.Context, block: (AgentJournal) -> T): T {
    val journal=AgentJournal(context)
    try { return block(journal) } finally { journal.close() }
}
