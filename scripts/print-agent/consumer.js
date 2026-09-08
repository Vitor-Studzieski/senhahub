const crypto = require('node:crypto');
const { buildTicketReceipt } = require('../../server/kiosk/escpos-receipt');
const ownership = job => ({jobId:job.id,leaseId:job.lease_id,attemptVersion:job.attempt_version});
class PrintConsumer {
  constructor({api,store,printer,logger={info(){},error(){}},signal,reconciliationMs=600000,clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,random=Math.random}) {
    Object.assign(this,{api,store,printer,logger,signal,clock,setTimer,clearTimer,random});
    this.reconciliationMs=Math.max(60000,reconciliationMs);
    this.pending=false;this.running=null;this.stopped=false;this.failures=0;this.state='connecting';this.nextAttemptAt=Infinity;
  }
  wake() {
    if(this.stopped)return;
    this.pending=true;
    if(this.running)return this.running;
    this.clearTimer(this.timer);
    this.running=this.run().finally(()=>{this.running=null;if(this.pending&&!this.stopped)this.wake();});
    return this.running;
  }
  arm(ms) { if(this.stopped)return;this.clearTimer(this.timer);this.timer=this.setTimer(()=>this.wake(),Math.max(1000,ms)); }
  async run() {
    try {
      while(this.pending&&!this.stopped) {
        this.pending=false;this.state='recovering';this.nextAttemptAt=Infinity;
        await this.recover();
        if(this.stopped)break;
        // A printing/lease uncertainty blocks this device until an operator
        // resolves it; do not claim a fresh job while the printer is fenced.
        if(this.state==='needs_review')continue;
        this.state='syncing';
        while(!this.stopped) {
          let requestId=this.store.get('claimRequestId');
          if(!requestId){requestId=crypto.randomUUID();this.store.set('claimRequestId',requestId);}
          let result;
          try {result=await this.api('claim',{requestId});}
          catch(error){if(error.status===409){this.store.delete('claimRequestId');}throw error;}
          this.store.delete('claimRequestId');this.rememberRetry(result.nextAttemptAt);
          if(!result.job)break;
          const job=result.job;
          // Claim replay can describe a job that has advanced: never blindly print it.
          if(job.status!=='leased'){if(['printing','needs_review'].includes(job.status))await this.reportUnknown(job);break;}
          await this.process(job);
          if(this.state==='needs_review')break;
        }
        this.failures=0;
      }
      if(this.state!=='needs_review')this.state='waiting';
      this.arm(Math.min(this.reconciliationMs,this.nextAttemptAt-this.clock()));
    } catch(error) {
      if(this.stopped)return;
      this.pending=false;
      if(this.state!=='needs_review')this.state=error.status===401||error.status===403?'unauthorized':'degraded';
      this.logger.error('Ciclo de impressao interrompido.',{state:this.state,status:error.status||0});
      this.arm(this.state==='unauthorized'?this.reconciliationMs:Math.min(300000,15000*2**Math.min(this.failures++,4))*(0.75+this.random()/2));
    }
  }
  rememberRetry(value){if(value){const time=Date.parse(value);if(Number.isFinite(time)&&time>this.clock())this.nextAttemptAt=Math.min(this.nextAttemptAt,time);}}
  async confirm(entry) {
    const result=await this.api('finish',{...ownership(entry.job),outcome:entry.outcome,error:entry.error});
    this.store.acknowledge(entry.job.lease_id);this.rememberRetry(result.nextAttemptAt);
    if(result.job?.status==='needs_review')this.state='needs_review';
  }
  async recover() {
    // A later wake may follow an operator resolution; recompute the fence
    // from durable server state instead of carrying the old notification.
    this.state='recovering';
    // Persisted acknowledgements are always retried before any claim, without physical I/O.
    for(const entry of this.store.pending()) {
      if(this.stopped)return;
      if(!entry.outcome) {
        const outcome=entry.phase==='leased'?'before_send':'unknown';
        this.store.save(entry.job,'result',outcome,'Agent restarted before durable result');
        entry.outcome=outcome;entry.error='Agent restarted before durable result';
      }
      try {await this.confirm(entry);} catch(error) {
        if(error.status!==409&&error.status!==403)throw error;
        // A revoked device must retain its journal for operational recovery.
        if(error.status===403)throw error;
        // Keep conflicting evidence, but do not print: operator must reconcile it.
        this.state='needs_review';throw error;
      }
    }
    const recovered=await this.api('recover',{});this.rememberRetry(recovered.nextAttemptAt);
    if(recovered.job) {
      if(recovered.job.status==='leased') {
        this.store.save(recovered.job,'result','before_send','Recovered lease without a local result');
        await this.confirm({job:recovered.job,outcome:'before_send',error:'Recovered lease before send'});
      } else if(recovered.job.status==='printing')await this.reportUnknown(recovered.job);
      else if(recovered.job.status==='needs_review')this.state='needs_review';
    }
  }
  async reportUnknown(job) {
    this.store.save(job,'result','unknown','Physical result unavailable');
    await this.confirm({job,outcome:'unknown',error:'Physical result unavailable'});
    this.state='needs_review';
  }
  async process(job) {
    this.store.save(job,'leased');
    let bytes;
    try {
      if(!job.payload?.ticketCode)throw new Error('Invalid receipt');
      bytes=buildTicketReceipt(job.payload);
    }catch(error){this.store.save(job,'result','before_send','Invalid receipt');await this.confirm({job,outcome:'before_send',error:'Invalid receipt'});return;}
    this.store.save(job,'starting');
    const started=await this.api('start',ownership(job));
    if(started.job?.status!=='printing')throw new Error('Start was not accepted');
    // A paused process must not send after its authorization window.
    if(Date.parse(started.job.lease_expires_at)-this.clock()<15000)throw new Error('Lease too close to expiry');
    this.state='printing';this.store.save(job,'writing');
    let outcome='printed',message=null;
    try {await this.printer.print(bytes,{signal:this.signal});}
    catch(error){outcome=error.beforeSend===true?'before_send':'unknown';message=outcome==='unknown'?'Physical send uncertain':'Printer unavailable before send';}
    // A journal error after physical I/O leaves "writing" for conservative recovery.
    this.store.save(job,'result',outcome,message);
    this.state='confirming';await this.confirm({job,outcome,error:message});
  }
  async stop(){this.stopped=true;this.clearTimer(this.timer);await this.running;this.state='stopped';}
}
module.exports={PrintConsumer,ownership};
