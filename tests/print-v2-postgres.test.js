const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {Pool}=require('pg');
const url=process.env.PRINT_TEST_DATABASE_URL;
const integration=url?test:test.skip;
integration('PostgreSQL v2: concurrency, fencing, recovery, issuance, RLS and audited reprint',async t=>{
 const pool=new Pool({connectionString:url,max:8});
 const q=async(s,v=[])=>(await pool.query(s,v)).rows;
 const call=async(name,args)=> (await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
 const kiosk='test-'+crypto.randomUUID(),printer=crypto.randomUUID(),d1=crypto.randomUUID(),d2=crypto.randomUUID(),auth=crypto.randomUUID();
 const sector=(await q("select id from sectors where store_code='loja-2' and status='open' limit 1"))[0].id;
 let counter=0;
 async function job(){return (await q("insert into print_jobs(kiosk_id,idempotency_key,payload) values($1,$2,$3) returning *",[kiosk,crypto.randomUUID(),JSON.stringify({ticketCode:'T'+ ++counter,sectorId:sector,issuedAt:new Date().toISOString()})]))[0];}
 const claim=(d,r=crypto.randomUUID())=>call('claim_next_print_job_v2',[d,r]);
 const start=(j,d=d1)=>call('start_print_job_v2',[d,j.id,j.lease_id,j.attempt_version]);
 const finish=(j,outcome='printed',d=d1)=>call('finish_print_job_v2',[d,j.id,j.lease_id,j.attempt_version,outcome,null]);
 try{
  await q("insert into print_printers(id,store_code,hardware_key,name) values($1,'loja-2',$2,'Test printer')",[printer,crypto.randomUUID()]);
  await q("insert into print_kiosks(id,name,printer_name,printer_port,install_url,store_code,printer_id,protocol_version) values($1,'Test','Test','TEST','https://example.test','loja-2',$2,2)",[kiosk,printer]);
  await q("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{\"identity_type\":\"print_device\"}')",[auth,crypto.randomUUID()+'@example.test']);
  await q("insert into print_devices(id,kiosk_id,store_code,printer_id,name,token_hash,auth_user_id) values($1::uuid,$3,'loja-2',$4,'A',$1::uuid::text,$5),($2::uuid,$3,'loja-2',$4,'B',$2::uuid::text,null)",[d1,d2,kiosk,printer,auth]);
  await t.test('technical identity creates no customer profile',async()=>assert.equal((await q('select * from profiles where id=$1',[auth])).length,0));
  await t.test('empty claim does not write device/kiosk activity',async()=>{await claim(d1);assert.equal((await q('select last_seen_at from print_devices where id=$1',[d1]))[0].last_seen_at,null);});
  let a,b,owned;
  await t.test('two agents, two jobs, one physical writer',async()=>{await job();await job();[a,b]=await Promise.all([claim(d1),claim(d2)]);assert.equal([a,b].filter(x=>x.job).length,1);owned=a.job?d1:d2;});
  const first=a.job||b.job;
  await t.test('wrong owner and attempt rejected',async()=>{await assert.rejects(finish(first,'printed',owned===d1?d2:d1),/owner_mismatch/);await assert.rejects(start({...first,attempt_version:99},owned),/owner_mismatch/);});
  await t.test('start and finish are idempotent',async()=>{await start(first,owned);await start(first,owned);const accepted=await finish(first,'printed',owned);assert.deepEqual(await finish(first,'printed',owned),accepted);assert.equal((await q('select * from print_job_attempts where job_id=$1',[first.id])).length,1);});
  await t.test('claim response lost recovers same execution',async()=>{const id=crypto.randomUUID();const x=await claim(d1,id),y=await claim(d1,id);assert.equal(x.job.lease_id,y.job.lease_id);assert.equal((await call('recover_print_execution_v2',[d1])).job.id,x.job.id);await finish(x.job,'before_send');await q("update print_jobs set next_attempt_at=now() where id=$1",[x.job.id]);});
  await t.test('expired unstarted lease can be reclaimed; old lease cannot finish',async()=>{const old=(await claim(d1)).job;await q("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[old.id]);const newer=(await claim(d2)).job;assert.equal(old.id,newer.id);assert.notEqual(old.lease_id,newer.lease_id);await assert.rejects(finish(old,'printed'),/owner_mismatch/);await start(newer,d2);await finish(newer,'printed',d2);});
  let uncertain;
  await t.test('expired fifth printing attempt blocks printer, preserves job',async()=>{const j=await job();await q('update print_jobs set attempts=4,attempt_version=4 where id=$1',[j.id]);uncertain=(await claim(d1)).job;await start(uncertain);await q("update print_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[j.id]);await call('sweep_print_leases_v2',[]);const recovered=await call('recover_print_execution_v2',[d1]);assert.equal(recovered.job.status,'needs_review');assert.equal(recovered.blocked,true);await job();assert.equal((await claim(d2)).job,null);});
  await t.test('durable success can settle same expired lease without reprinting',async()=>{await finish(uncertain);assert.equal((await q('select blocked_job_id from print_printers where id=$1',[printer]))[0].blocked_job_id,null);const j=(await claim(d1)).job;await start(j);await finish(j);});
  await t.test('revocation prevents commands immediately',async()=>{await q('update print_devices set revoked_at=now() where id=$1',[d2]);await assert.rejects(claim(d2),/device_revoked/);});
  await t.test('cross-store/printer device registration rejected',async()=>{await assert.rejects(q("insert into print_devices(kiosk_id,store_code,printer_id,name,token_hash) values($1,'loja-1',$2,'bad',$3)",[kiosk,printer,crypto.randomUUID()]),/foreign key/);});
  await t.test('v1 cannot claim v2 destination',async()=>await assert.rejects(call('claim_next_print_job',[kiosk]),/upgrade_required/));
  await t.test('private membership scopes topic and no RPC execution for authenticated',async()=>{
   const client=await pool.connect();try{await client.query('begin');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[auth]);await client.query('set local role authenticated');
    const allowed=(await client.query("select print_private.can_receive_print($1) ok, print_private.can_receive_print('senhahub:print:v2:other') bad",['senhahub:print:v2:'+kiosk])).rows[0];assert.equal(allowed.ok,true);assert.equal(allowed.bad,false);
    await client.query("select set_config('realtime.topic',$1,true)",['senhahub:print:v2:'+kiosk]);
    await client.query('savepoint denied_publish');
    await assert.rejects(client.query("insert into realtime.messages(id,topic,extension) values(1,$1,'broadcast')",['senhahub:print:v2:'+kiosk]),/row-level security/);
    await client.query('rollback to savepoint denied_publish');
    await client.query('savepoint denied_jobs');await assert.rejects(client.query('select * from print_jobs'),/permission denied/);await client.query('rollback to savepoint denied_jobs');
    await assert.rejects(client.query('select claim_next_print_job_v2($1,$2)',[d1,crypto.randomUUID()]),/permission denied/);
   }finally{await client.query('rollback');client.release();}
  });
  let issued;
  await t.test('concurrent emission key produces exactly one ticket and conflicts reject',async()=>{const id=crypto.randomUUID(),args=[kiosk,sector,id,'https://example.test','https://example.test',false,null,30];const [x,y]=await Promise.all([call('issue_physical_ticket',args),call('issue_physical_ticket',args)]);assert.equal(x.ticket.id,y.ticket.id);issued=x;args[5]=true;await assert.rejects(call('issue_physical_ticket',args),/idempotency_conflict/);});
  await t.test('unresolved ticket cannot cascade away',async()=>await assert.rejects(q('delete from tickets where id=$1',[issued.ticket.id]),/unresolved_print_job/));
  await t.test('audited reprint creates a new job and operator decision fences late finish',async()=>{
   const j=(await claim(d1)).job;await start(j);await finish(j,'unknown');
   const admin=crypto.randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[admin,crypto.randomUUID()+'@example.test']);await q("update profiles set role='admin' where id=$1",[admin]);
   const args=[admin,j.id,crypto.randomUUID(),'reprint','Writer stopped and receipt checked',true];const op=await call('resolve_print_job_v2',args);assert.notEqual(op.reprint.id,j.id);assert.equal(op.reprint.reprint_of,j.id);assert.deepEqual(await call('resolve_print_job_v2',args),op);await assert.rejects(finish(j,'printed'),/finish_conflict|invalid_print_transition/);
  });
 }finally{await pool.end();}
});
