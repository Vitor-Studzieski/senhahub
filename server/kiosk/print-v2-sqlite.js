const crypto=require('node:crypto');const {EventEmitter}=require('node:events');
const ACTIVE=['leased','printing','needs_review'];
const error=message=>{throw new Error(message)};
/** SQLite storage adapter for the same v2 command contract; one IMMEDIATE transaction
 * contains printer exclusion, job transition and attempt history. Event delivery is separate. */
class SqlitePrintQueue {
 constructor(db){this.db=db;this.events=new EventEmitter();this.migrate();}
 migrate(){
  const db=this.db;
  if(db.prepare("PRAGMA table_info(print_jobs)").all().some(c=>c.name==='lease_id'))return;
  // SQLite cannot remove an inline UNIQUE/FK constraint with ALTER COLUMN. Rebuild
  // inside one transaction, copying every original row before replacing the table.
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  if(!db.prepare('PRAGMA table_info(print_kiosks)').all().some(c=>c.name==='store_code'))db.exec("ALTER TABLE print_kiosks ADD COLUMN store_code TEXT NOT NULL DEFAULT 'loja-1'");
  try{
   db.exec(`CREATE TABLE print_jobs_v2 (
    id TEXT PRIMARY KEY,ticket_id TEXT,kiosk_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
    claimed_at TEXT,printed_at TEXT,failed_at TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    protocol_version INTEGER NOT NULL DEFAULT 1,device_id TEXT,printer_id TEXT,lease_id TEXT,lease_expires_at TEXT,
    attempt_version INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,send_started_at TEXT,reprint_of TEXT,resolved_at TEXT,
    FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,FOREIGN KEY(kiosk_id) REFERENCES print_kiosks(id));
    INSERT INTO print_jobs_v2(id,ticket_id,kiosk_id,idempotency_key,status,payload,attempts,claimed_at,printed_at,failed_at,last_error,created_at,updated_at)
      SELECT id,ticket_id,kiosk_id,idempotency_key,status,payload,attempts,claimed_at,printed_at,failed_at,last_error,created_at,updated_at FROM print_jobs;
    DROP TABLE print_jobs; ALTER TABLE print_jobs_v2 RENAME TO print_jobs;
    CREATE UNIQUE INDEX print_jobs_original_ticket ON print_jobs(ticket_id) WHERE reprint_of IS NULL;
    CREATE UNIQUE INDEX print_jobs_one_writer ON print_jobs(printer_id) WHERE protocol_version=2 AND status IN ('leased','printing','needs_review');
    CREATE INDEX print_jobs_eligible_v2 ON print_jobs(kiosk_id,next_attempt_at,created_at) WHERE status IN ('pending','retry_wait');
    CREATE INDEX print_jobs_leases_v2 ON print_jobs(lease_expires_at) WHERE status IN ('leased','printing');
    ALTER TABLE print_kiosks ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE print_kiosks ADD COLUMN printer_id TEXT;
    CREATE UNIQUE INDEX print_kiosks_one_printer ON print_kiosks(printer_id);
    CREATE TABLE print_printers(id TEXT PRIMARY KEY,store_code TEXT NOT NULL,hardware_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,blocked_job_id TEXT);
    CREATE TABLE print_devices(id TEXT PRIMARY KEY,kiosk_id TEXT NOT NULL,store_code TEXT NOT NULL,printer_id TEXT NOT NULL,name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,agent_version TEXT NOT NULL DEFAULT '',capabilities TEXT NOT NULL DEFAULT '{}',last_seen_at TEXT,created_at TEXT NOT NULL);
    ALTER TABLE print_job_attempts ADD COLUMN device_id TEXT;
    ALTER TABLE print_job_attempts ADD COLUMN lease_id TEXT;
    ALTER TABLE print_job_attempts ADD COLUMN request_id TEXT;
    ALTER TABLE print_job_attempts ADD COLUMN finish_outcome TEXT;
    ALTER TABLE print_job_attempts ADD COLUMN finish_result TEXT;
    CREATE UNIQUE INDEX print_attempt_lease ON print_job_attempts(lease_id) WHERE lease_id IS NOT NULL;
    CREATE UNIQUE INDEX print_attempt_request ON print_job_attempts(device_id,request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE print_operations(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,job_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,action TEXT NOT NULL,reason TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE print_emissions(kiosk_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(kiosk_id,idempotency_key));
    CREATE TRIGGER print_job_protocol AFTER INSERT ON print_jobs BEGIN UPDATE print_jobs SET protocol_version=(SELECT protocol_version FROM print_kiosks WHERE id=NEW.kiosk_id),printer_id=(SELECT printer_id FROM print_kiosks WHERE id=NEW.kiosk_id) WHERE id=NEW.id; END;
    CREATE TRIGGER print_ticket_guard BEFORE DELETE ON tickets WHEN EXISTS(SELECT 1 FROM print_jobs j WHERE
      (j.ticket_id=OLD.id OR EXISTS(SELECT 1 FROM json_each(j.payload,'$.ticketIds') WHERE value=OLD.id)) AND j.status<>'printed' AND j.resolved_at IS NULL)
      BEGIN SELECT RAISE(ABORT,'unresolved_print_job'); END;
    CREATE TRIGGER print_device_scope BEFORE INSERT ON print_devices WHEN NOT EXISTS(SELECT 1 FROM print_kiosks k JOIN print_printers p ON p.id=k.printer_id WHERE k.id=NEW.kiosk_id AND k.printer_id=NEW.printer_id AND p.store_code=NEW.store_code AND k.store_code=NEW.store_code)
      BEGIN SELECT RAISE(ABORT,'device_scope_invalid'); END;`);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
 }
 select(table,field,value){return this.db.prepare(`SELECT * FROM ${table} WHERE ${field}=? LIMIT 1`).all(value).map(row=>({...row,active:Boolean(row.active),capabilities:row.capabilities?JSON.parse(row.capabilities):undefined}));}
 job(id){const j=this.db.prepare('SELECT * FROM print_jobs WHERE id=?').get(id);return j?{...j,payload:JSON.parse(j.payload)}:null;}
 update(table,id,values){this.db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(values),id);}
 rpc(name,args){
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=this.command(name,args);this.db.exec('COMMIT');if(result?.job?.kiosk_id && (name==='resolve_print_job_v2' || (name==='finish_print_job_v2' && result.job.status==='retry_wait')))queueMicrotask(()=>this.events.emit('available',result.job.kiosk_id));return result;}
  catch(e){this.db.exec('ROLLBACK');return {error:e.message};}
 }
 command(name,a){
  const now=new Date().toISOString();
  if(name==='resolve_print_job_v2')return this.resolve(a,now);
  const d=this.db.prepare('SELECT * FROM print_devices WHERE id=?').get(a.p_device_id);
  if(!d||!d.active||d.revoked_at)error('device_revoked');
  const k=this.db.prepare('SELECT * FROM print_kiosks WHERE id=?').get(d.kiosk_id);
  const p=this.db.prepare('SELECT * FROM print_printers WHERE id=?').get(d.printer_id);
  if(!k?.active||k.protocol_version!==2||k.printer_id!==d.printer_id||p?.store_code!==d.store_code||k.store_code!==d.store_code)error('device_scope_invalid');
  if(name==='record_print_device_session_v2'){this.update('print_devices',d.id,{agent_version:String(a.p_version).slice(0,80),last_seen_at:now});return null;}
  if(name==='claim_next_print_job_v2'||name==='recover_print_execution_v2'){
   this.expirePrinter(p.id,now);
   const own=this.db.prepare("SELECT id FROM print_jobs WHERE device_id=? AND status IN ('leased','printing','needs_review') LIMIT 1").get(d.id);
   const blocked=this.db.prepare('SELECT blocked_job_id FROM print_printers WHERE id=?').get(p.id).blocked_job_id;
   const next=this.db.prepare("SELECT min(next_attempt_at) next FROM print_jobs WHERE kiosk_id=? AND status='retry_wait'").get(k.id).next;
   const recovery={job:own?this.job(own.id):null,blocked:Boolean(blocked),nextAttemptAt:next};
   if(name==='recover_print_execution_v2')return recovery;
   const old=this.db.prepare('SELECT * FROM print_job_attempts WHERE device_id=? AND request_id=?').get(d.id,a.p_request_id);
   if(old){const j=this.job(old.job_id);if(j.lease_id!==old.lease_id)error('stale_claim');return {job:j};}
   if(own||blocked)return {...recovery,job:null,blocked:true};
   if(this.db.prepare("SELECT 1 FROM print_jobs WHERE printer_id=? AND status IN ('leased','printing','needs_review')").get(p.id))return {job:null};
   const row=this.db.prepare("SELECT id FROM print_jobs WHERE kiosk_id=? AND printer_id=? AND protocol_version=2 AND attempts<5 AND (status='pending' OR (status='retry_wait' AND next_attempt_at<=?)) ORDER BY created_at,id LIMIT 1").get(k.id,p.id,now);
   if(!row)return recovery;
   const j=this.job(row.id),lease=crypto.randomUUID();
   this.update('print_jobs',j.id,{status:'leased',device_id:d.id,lease_id:lease,lease_expires_at:new Date(Date.now()+90000).toISOString(),attempt_version:j.attempt_version+1,attempts:j.attempts+1,claimed_at:now,send_started_at:null,next_attempt_at:null,last_error:null,updated_at:now});
   this.db.prepare('INSERT INTO print_job_attempts(id,job_id,kiosk_id,attempt_number,started_at,status,created_at,device_id,lease_id,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),j.id,k.id,j.attempt_version+1,now,'leased',now,d.id,lease,a.p_request_id);
   this.update('print_devices',d.id,{last_seen_at:now});return {job:this.job(j.id)};
  }
  const j=this.job(a.p_job_id);
  if(!j||j.protocol_version!==2||j.device_id!==d.id||j.printer_id!==p.id||j.kiosk_id!==k.id||j.lease_id!==a.p_lease_id||j.attempt_version!==a.p_attempt_version)error('print_owner_mismatch');
  if(name==='start_print_job_v2'||name==='renew_print_lease_v2'){
   if(!['leased','printing'].includes(j.status)||j.lease_expires_at<=now)error('lease_expired');
   if(name==='start_print_job_v2'&&j.status==='printing')return {job:j};
   if(name==='renew_print_lease_v2'&&Date.parse(j.claimed_at)<Date.now()-600000)error('lease_expired');
   this.update('print_jobs',j.id,{...(name==='start_print_job_v2'?{status:'printing',send_started_at:now}:{}),lease_expires_at:new Date(Date.now()+90000).toISOString()});
   if(name==='start_print_job_v2')this.db.prepare("UPDATE print_job_attempts SET status='printing' WHERE lease_id=?").run(j.lease_id);
   return {job:this.job(j.id)};
  }
  if(name!=='finish_print_job_v2')error('unsupported_command');
  const attempt=this.db.prepare('SELECT * FROM print_job_attempts WHERE lease_id=?').get(j.lease_id);
  if(attempt.finish_outcome){if(attempt.finish_outcome==='printed')return JSON.parse(attempt.finish_result);if(attempt.finish_outcome!==a.p_outcome)error('finish_conflict');return JSON.parse(attempt.finish_result);}
  if(!['printed','unknown','before_send'].includes(a.p_outcome))error('invalid_print_outcome');
  if(a.p_outcome==='before_send'&&['retry_wait','failed'].includes(j.status)&&!j.send_started_at&&!j.resolved_at){const result={ok:true,job:j,nextAttemptAt:j.next_attempt_at};this.update('print_job_attempts',attempt.id,{finish_outcome:a.p_outcome,finish_result:JSON.stringify(result)});return result;}
  if(j.resolved_at||!ACTIVE.includes(j.status))error('invalid_print_transition');
  if(a.p_outcome==='printed'&&!j.send_started_at)error('print_not_started');
  if(a.p_outcome==='before_send'&&j.status==='needs_review')error('review_required');
  const status=a.p_outcome==='printed'?'printed':a.p_outcome==='unknown'?'needs_review':j.attempts>=5?'failed':'retry_wait';
  const next=status==='retry_wait'?new Date(Date.now()+Math.min(300,15*2**Math.min(j.attempts,4))*1000).toISOString():null;
  this.update('print_jobs',j.id,{status,printed_at:status==='printed'?now:null,failed_at:status==='printed'?null:now,next_attempt_at:next,last_error:a.p_error||null,updated_at:now});
  this.update('print_printers',p.id,{blocked_job_id:status==='needs_review'?j.id:null});
  const result={ok:true,job:this.job(j.id),nextAttemptAt:next};
  this.update('print_job_attempts',attempt.id,{status,finish_outcome:a.p_outcome,finish_result:JSON.stringify(result),finished_at:now,duration_ms:Math.max(0,Date.now()-Date.parse(attempt.started_at))});
  this.update('print_devices',d.id,{last_seen_at:now});return result;
 }
 expirePrinter(printerId,now){
   for(const old of this.db.prepare("SELECT id FROM print_jobs WHERE printer_id=? AND status IN ('leased','printing') AND lease_expires_at<=?").all(printerId,now)){
    const j=this.job(old.id),status=j.status==='printing'?'needs_review':j.attempts>=5?'failed':'retry_wait';
    this.update('print_jobs',j.id,{status,next_attempt_at:now,last_error:'Lease expired'});
    this.db.prepare('UPDATE print_job_attempts SET status=?,error_message=? WHERE lease_id=?').run(status==='needs_review'?status:'reprocessed','Lease expired',j.lease_id);
    if(status==='needs_review')this.update('print_printers',printerId,{blocked_job_id:j.id});
   }

 }
 sweep(){
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const now=new Date().toISOString();
   const printers=this.db.prepare("SELECT DISTINCT printer_id FROM print_jobs WHERE protocol_version=2 AND status IN ('leased','printing') AND lease_expires_at<=?").all(now);
   for(const p of printers)this.expirePrinter(p.printer_id,now);
   this.db.exec('COMMIT');
   for(const p of printers){const k=this.db.prepare('SELECT id FROM print_kiosks WHERE printer_id=?').get(p.printer_id);if(k)this.events.emit('available',k.id);}
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 resolve(a,now){
  const actor=this.db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND status='active'").get(a.p_actor_id);if(!actor)error('admin_required');
  if(a.p_writer_stopped!==true||String(a.p_reason||'').trim().length<5)error('operator_confirmation_required');
  const op=this.db.prepare('SELECT * FROM print_operations WHERE request_id=?').get(a.p_request_id);
  if(op){if(op.actor_id!==actor.id||op.job_id!==a.p_job_id||op.action!==a.p_action)error('operation_conflict');return JSON.parse(op.result);}
  const j=this.job(a.p_job_id);if(!j||j.protocol_version!==2||!['printed','failed','needs_review'].includes(j.status)||j.resolved_at||!['confirm_printed','resolve_failed','reprint'].includes(a.p_action))error('invalid_resolution');
  this.update('print_jobs',j.id,{resolved_at:now,status:a.p_action==='confirm_printed'?'printed':j.status==='needs_review'?'failed':j.status});
  this.db.prepare('UPDATE print_printers SET blocked_job_id=NULL WHERE id=? AND blocked_job_id=?').run(j.printer_id,j.id);let child=null;
  if(a.p_action==='reprint'){const id=crypto.randomUUID();this.db.prepare("INSERT INTO print_jobs(id,ticket_id,kiosk_id,idempotency_key,payload,reprint_of,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id,j.ticket_id,j.kiosk_id,'reprint:'+a.p_request_id,JSON.stringify(j.payload),j.id,now,now);child=this.job(id);}
  const result={job:this.job(j.id),reprint:child};this.db.prepare('INSERT INTO print_operations VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),actor.id,j.id,a.p_request_id,a.p_action,a.p_reason,JSON.stringify(result),now);return result;
 }
}
module.exports={SqlitePrintQueue};
