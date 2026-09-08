// Creates a new isolated database. Never applies test fixtures to an existing database.
const fs=require('node:fs');const {Client}=require('pg');const {spawn}=require('node:child_process');
async function main(){
 const url=new URL(process.env.PRINT_TEST_ADMIN_URL||'postgres://postgres:print-v2-test-only@127.0.0.1:55439/postgres');
 if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Test runner requires loopback PostgreSQL');
 const admin=new Client({connectionString:url.href});await admin.connect();
 const name='print_v2_test_'+Date.now();await admin.query(`CREATE DATABASE ${name}`);await admin.end();url.pathname='/'+name;
 const c=new Client({connectionString:url.href});await c.connect();
 try{
  // Minimal Supabase Realtime surface permits real policy permission tests locally.
  await c.query(`CREATE SCHEMA realtime; CREATE TABLE realtime.messages(id bigint,topic text,extension text); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;`);
  for(const file of fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()) {
   try{await c.query('BEGIN');await c.query(fs.readFileSync('supabase/migrations/'+file,'utf8'));await c.query('COMMIT');}
   catch(e){await c.query('ROLLBACK');throw new Error(file+': '+e.message);}
  }
  await c.query('GRANT USAGE ON SCHEMA realtime TO authenticated; GRANT SELECT,INSERT ON realtime.messages TO authenticated');
 }finally{await c.end();}
 console.log('Migrations applied transactionally to isolated database: '+name);
 const child=spawn(process.execPath,['--test','tests/print-v2-postgres.test.js'],{stdio:'inherit',env:{...process.env,PRINT_TEST_DATABASE_URL:url.href}});
 process.exitCode=await new Promise(resolve=>child.on('exit',resolve));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
