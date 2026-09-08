const crypto=require('node:crypto');
const {Client}=require('pg');
const {query,getLocalDatabaseUrl}=require('../data/local-postgres');
const {createPrintV2Api}=require('./print-v2-api');
const {requireLocalUser,requireCsrf}=require('../platform/local-route-helpers');
function eventStream(request,subscribe){
 const encoder=new TextEncoder();let cleanup=()=>{},timer,ttl;
 const stream=new ReadableStream({async start(controller){
   let closed=false;
   const close=()=>{if(closed)return;closed=true;cleanup();clearInterval(timer);clearTimeout(ttl);try{controller.close()}catch{}};
   const send=(event)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));};
   try{
    cleanup=await subscribe(()=>send('print_job.available'),close);
    if(request.signal.aborted){close();return;}
    request.signal.addEventListener('abort',close,{once:true});
    send('ready');timer=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': connection\n\n'))},25000);
    ttl=setTimeout(close,600000); // Reauthorize the destination on reconnect.
   }catch{close()}
 },cancel(){cleanup();clearInterval(timer);clearTimeout(ttl);}});
 return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'}});
}
function createLocalPrintApi({sqlite,requireAdmin}={}) {
 const select=async(table,filter)=>{
   if(!['print_devices','print_kiosks'].includes(table))throw new Error('Invalid local table');
   const params=new URLSearchParams(filter);const [field,filterValue]=[...params.entries()].find(([k])=>k!=='limit');
   if(!['id','auth_user_id','token_hash'].includes(field)||!filterValue.startsWith('eq.'))throw new Error('Invalid local filter');
   const value=filterValue.slice(3);
   if(sqlite)return sqlite.select(table,field,value);
   return (await query(`select * from public.${table} where ${field}=$1 limit 1`,[value])).rows;
 };
 const localAuthenticate=async token=>{
   if(token.length<32)return null;
   return (await select('print_devices','token_hash=eq.'+crypto.createHash('sha256').update(token).digest('hex')))[0];
 };
 return createPrintV2Api({select,localAuthenticate,
   rpc:async(name,args)=>{
    if(sqlite)return sqlite.rpc(name,args);
    if(!/^(claim_next_print_job_v2|recover_print_execution_v2|start_print_job_v2|finish_print_job_v2|renew_print_lease_v2|resolve_print_job_v2|record_print_device_session_v2)$/.test(name))throw new Error('Unsupported local command');
    try{return (await query(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}catch(e){return {error:e.message};}
   },
   requireAdmin:requireAdmin||(async request=>{const user=await requireLocalUser(request,['admin']);if(user.response)return user;const error=requireCsrf(request,user.session);return error?{response:error}:user.session.user;}),
   eventResponse:(request,device)=>eventStream(request,async(onEvent,onClose)=>{
    if(sqlite){const listener=kiosk=>{if(kiosk===device.kiosk_id)onEvent()};sqlite.events.on('available',listener);return ()=>sqlite.events.off('available',listener);}
    const client=new Client({connectionString:getLocalDatabaseUrl(),application_name:'senhahub-print-events'});
    client.on('error',onClose);await client.connect();
    client.on('notification',event=>{try{if(JSON.parse(event.payload).kiosk_id===device.kiosk_id)onEvent()}catch{}});
    await client.query('LISTEN senhahub_print_v2');return ()=>{client.end().catch(()=>{});};
   })
 });
}
let api;
async function handleLocalPrintV2(request){
 if(process.env.DATA_BACKEND!=='local-postgres'||process.env.LOCAL_POSTGRES_ROUTES_ENABLED!=='1')return Response.json({error:'Local route disabled'},{status:404});
 api ||=createLocalPrintApi();return api.handle(request);
}
module.exports={createLocalPrintApi,handleLocalPrintV2,eventStream};
