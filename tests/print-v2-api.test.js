const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {createPrintV2Api}=require('../server/kiosk/print-v2-api');
function fixture(){const d={id:crypto.randomUUID(),auth_user_id:crypto.randomUUID(),kiosk_id:'kiosk-a',store_code:'loja-2',printer_id:crypto.randomUUID(),active:true};const calls=[];const api=createPrintV2Api({env:{},supabaseFetch:async(_path,{bearer})=>bearer==='valid'?{id:d.auth_user_id}:{error:'expired'},select:async table=>table==='print_devices'?[d]:[{id:d.kiosk_id,active:true,protocol_version:2,printer_id:d.printer_id,store_code:d.store_code}],rpc:async(name,args)=>{calls.push({name,args});return {job:null}},requireAdmin:async()=>({response:Response.json({error:'denied'},{status:403})})});return {d,calls,request:(command,body={},token='valid')=>api.handle(new Request('https://test/api/print/v2/'+command,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}))};}
test('API resolves identity from verified token; client cannot select destination',async()=>{const f=fixture();for(const key of ['deviceId','kioskId','printerId','storeCode','sectorId']){const r=await f.request('claim',{requestId:crypto.randomUUID(),[key]:'other'});assert.equal(r.status,403)}assert.equal(f.calls.length,0);await f.request('claim',{requestId:crypto.randomUUID()});assert.equal(f.calls[0].args.p_device_id,f.d.id)});
test('expired token and revoked device cannot run commands',async()=>{const f=fixture();assert.equal((await f.request('recover',{},'expired')).status,401);f.d.revoked_at=new Date().toISOString();assert.equal((await f.request('recover')).status,403);assert.equal(f.calls.length,0)});
test('malformed lease and version rejected before RPC',async()=>{const f=fixture();assert.equal((await f.request('finish',{jobId:crypto.randomUUID(),leaseId:'bad',attemptVersion:1,outcome:'printed'})).status,400);assert.equal(f.calls.length,0)});
test('reprint requires authorized administrator',async()=>{const f=fixture();assert.equal((await f.request('resolve',{action:'reprint'})).status,403);assert.equal(f.calls.length,0)});

test('Realtime private subscription wakes only after SUBSCRIBED and on matching broadcast',async()=>{
 const {PrintRealtimeSignal}=require('../scripts/print-agent/realtime');let status,broadcast,config,wakes=0;
 const channel={on:(_type,_filter,cb)=>{broadcast=cb;return channel},subscribe:cb=>{status=cb;return channel}};
 const client={auth:{getSession:async()=>({data:{session:{access_token:'secret'}}})},realtime:{setAuth:async token=>assert.equal(token,'secret')},channel:(_topic,c)=>{config=c;return channel},removeChannel:async()=>{}};
 const signal=new PrintRealtimeSignal({client,topic:'senhahub:print:v2:test',onSignal:()=>wakes++});
 await signal.start();assert.equal(wakes,0);assert.equal(config.config.private,true);
 status('SUBSCRIBED');assert.equal(wakes,1);broadcast();assert.equal(wakes,2);await signal.stop();
});
