const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
class DurableStore {
  constructor(directory) {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const file = path.join(directory,'agent-v2.sqlite');
    this.db = new DatabaseSync(file);
    fs.chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS executions(lease_id TEXT PRIMARY KEY,job TEXT NOT NULL,phase TEXT NOT NULL,outcome TEXT,error TEXT,acknowledged INTEGER NOT NULL DEFAULT 0);`);
  }
  get(key) { const row=this.db.prepare('SELECT value FROM state WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key,value) { this.db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  delete(key) { this.db.prepare('DELETE FROM state WHERE key=?').run(key); }
  save(job,phase,outcome=null,error=null) {
    this.db.prepare(`INSERT INTO executions(lease_id,job,phase,outcome,error) VALUES(?,?,?,?,?)
      ON CONFLICT(lease_id) DO UPDATE SET job=excluded.job,phase=excluded.phase,outcome=excluded.outcome,error=excluded.error`).run(job.lease_id,JSON.stringify(job),phase,outcome,error);
  }
  pending() { return this.db.prepare('SELECT * FROM executions WHERE acknowledged=0').all().map(r=>({...r,job:JSON.parse(r.job)})); }
  acknowledge(leaseId) { this.db.prepare('UPDATE executions SET acknowledged=1 WHERE lease_id=?').run(leaseId); }
  close() { this.db.close(); }
}
// OS-owned lock survives no process: no stale-file deletion race after a crash.
async function acquirePrinterLock(printerPort) {
  const number=20000+crypto.createHash('sha256').update(String(printerPort).toUpperCase()).digest().readUInt16BE(0)%30000;
  const server=net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',()=>reject(new Error('Outra instancia usa esta impressora (ou a porta de exclusao esta ocupada).')));server.listen({host:'127.0.0.1',port:number,exclusive:true},resolve);});
  return ()=>new Promise(resolve=>server.close(resolve));
}
module.exports={DurableStore,acquirePrinterLock};
