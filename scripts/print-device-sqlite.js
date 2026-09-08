const fs=require('node:fs');const crypto=require('node:crypto');const {DatabaseSync}=require('node:sqlite');const {SqlitePrintQueue}=require('../server/kiosk/print-v2-sqlite');
function main(){
 if(!process.env.PRINT_SQLITE_PATH||!process.argv[2])throw new Error('Set PRINT_SQLITE_PATH and pass an input JSON file');
 const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),db=new DatabaseSync(process.env.PRINT_SQLITE_PATH);new SqlitePrintQueue(db);
 db.exec('BEGIN IMMEDIATE');
 try{
  const k=db.prepare('SELECT * FROM print_kiosks WHERE id=?').get(input.kioskId);
  if(!k)throw new Error('Destination does not exist');
  if(input.action==='register-printer'){
   if(k.printer_id||!input.hardwareKey||!/^loja-\d+$/.test(input.storeCode))throw new Error('Invalid physical printer registration');
   const id=crypto.randomUUID();db.prepare('INSERT INTO print_printers(id,store_code,hardware_key,name) VALUES(?,?,?,?)').run(id,input.storeCode,input.hardwareKey,input.name||'Printer');
   db.prepare('UPDATE print_kiosks SET printer_id=?,store_code=? WHERE id=?').run(id,input.storeCode,k.id);
  }else if(input.action==='provision-local'){
   if(!k.printer_id||!input.outputFile)throw new Error('Printer and output file required');
   const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
   db.prepare('INSERT INTO print_devices(id,kiosk_id,printer_id,store_code,name,token_hash,capabilities,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,k.id,k.printer_id,k.store_code,input.name||'Agent',crypto.createHash('sha256').update(token).digest('hex'),JSON.stringify({simulator:input.simulator===true}),new Date().toISOString());
   fs.writeFileSync(input.outputFile,JSON.stringify({deviceId:id,PRINT_DEVICE_LOCAL_TOKEN:token},null,2),{mode:0o600,flag:'wx'});
  }else if(input.action==='activate'){
   if(input.writerStopped!==true||!k.printer_id||db.prepare("SELECT 1 FROM print_jobs WHERE kiosk_id=? AND status IN ('leased','printing','needs_review')").get(k.id))throw new Error('Stop and resolve existing executions before activation');
   db.prepare('UPDATE print_kiosks SET protocol_version=2 WHERE id=?').run(k.id);
   db.prepare("UPDATE print_jobs SET protocol_version=2,printer_id=? WHERE kiosk_id=? AND status='pending'").run(k.printer_id,k.id);
  }else if(input.action==='revoke')db.prepare('UPDATE print_devices SET active=0,revoked_at=? WHERE id=? AND kiosk_id=?').run(new Date().toISOString(),input.deviceId,k.id);
  else throw new Error('Unsupported action');
  db.exec('COMMIT');console.log('Print administration applied. No credentials logged.');
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close()}
}
try{main()}catch{console.error('Print administration failed; verify destination, input and database.');process.exitCode=1}
