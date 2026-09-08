const {createClient}=require('@supabase/supabase-js');
async function openDeviceSession(config,store,signal) {
  let connection=store.get('connection');
  if(!connection) {
    if(config.localToken) return {token:async()=>config.localToken,client:null,close:async()=>{}};
    if(!config.enrollmentCode)throw new Error('Pareamento necessario: configure PRINT_ENROLLMENT_CODE.');
    const response=await fetch(`${config.apiUrl}/api/print/v2/enroll`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:config.enrollmentCode}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    if(!response.ok)throw new Error(`Pareamento recusado (HTTP ${response.status}).`);
    const data=await response.json();
    connection={url:data.supabaseUrl,key:data.supabaseKey};
    store.set('session',data.session);store.set('connection',connection);
  }
  const client=createClient(connection.url,connection.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}}});
  const saved=store.get('session');
  if(saved){const {error}=await client.auth.setSession(saved);if(error)throw new Error('Sessao do dispositivo invalida; pareamento necessario.');store.delete('session');}
  const token=async()=>{
    const {data,error}=await client.auth.getSession();
    if(error||!data.session)throw Object.assign(new Error('Sessao indisponivel'),{status:401});
    return data.session.access_token;
  };
  return {client,token,close:async()=>{client.auth.stopAutoRefresh();await client.removeAllChannels();}};
}
function deviceApi(config,session,signal) {
  return async(command,body={})=>{
    const response=await fetch(`${config.apiUrl}/api/print/v2/${command}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await session.token()}`,'x-print-agent-version':'node/2.0.0'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'Print command failed'),{status:response.status});
    return data;
  };
}
module.exports={openDeviceSession,deviceApi};
