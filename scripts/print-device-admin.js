// Run on a trusted backend host; never distribute server credentials with an agent.
// Input/output files avoid putting tokens into shell history or logs.
const fs=require('node:fs');const crypto=require('node:crypto');const {Pool}=require('pg');
async function main(){
 const file=process.argv[2];if(!file)throw new Error('Usage: node scripts/print-device-admin.js input.json');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const pool=new Pool({connectionString:process.env.LOCAL_DATABASE_URL||process.env.PRINT_ADMIN_DATABASE_URL});
 if(!process.env.LOCAL_DATABASE_URL&&!process.env.PRINT_ADMIN_DATABASE_URL)throw new Error('Configure a trusted backend database URL');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  if(input.action==='register-printer') {
   if(!input.hardwareKey||!input.kioskId||!input.storeCode)throw new Error('hardwareKey, kioskId and storeCode required');
   const existing=(await client.query('SELECT * FROM public.print_kiosks WHERE id=$1 FOR UPDATE',[input.kioskId])).rows[0];
   if(!existing||existing.store_code!==input.storeCode||existing.printer_id)throw new Error('Invalid kiosk scope or printer already registered');
   const id=crypto.randomUUID();
   await client.query('INSERT INTO public.print_printers(id,store_code,hardware_key,name) VALUES($1,$2,$3,$4)',[id,input.storeCode,input.hardwareKey,input.name||input.hardwareKey]);
   await client.query('UPDATE public.print_kiosks SET printer_id=$1 WHERE id=$2',[id,input.kioskId]);
   console.log('Printer registered: '+id);
  } else if(input.action==='provision-local') {
   if(!process.env.LOCAL_DATABASE_URL||!input.outputFile)throw new Error('Local provisioning requires LOCAL_DATABASE_URL and outputFile');
   const k=(await client.query('SELECT * FROM public.print_kiosks WHERE id=$1 FOR UPDATE',[input.kioskId])).rows[0];
   if(!k?.printer_id)throw new Error('Register the physical printer first');
   const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
   await client.query('INSERT INTO public.print_devices(id,kiosk_id,store_code,printer_id,name,token_hash,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,k.id,k.store_code,k.printer_id,input.name||'Local agent',crypto.createHash('sha256').update(token).digest('hex'),JSON.stringify({simulator:input.simulator===true})]);
   fs.writeFileSync(input.outputFile,JSON.stringify({deviceId:id,PRINT_DEVICE_LOCAL_TOKEN:token},null,2),{mode:0o600,flag:'wx'});
   console.log('Local credential written to the specified file.');
  } else if(input.action==='activate') {
   if(input.writerStopped!==true)throw new Error('Stop the legacy writer and set writerStopped=true');
   await client.query('SELECT public.activate_print_protocol_v2($1)',[input.kioskId]);
   console.log('Destination activated for v2.');
  } else if(input.action==='revoke') {
   await client.query('UPDATE public.print_devices SET active=false,revoked_at=now() WHERE id=$1',[input.deviceId]);
   console.log('Device revoked. Unresolved jobs and journals were preserved.');
  } else throw new Error('Unsupported action');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
main().catch(()=>{console.error('Print administration failed. Check input, scope and database configuration; no credentials logged.');process.exitCode=1});
