const crypto = require('node:crypto');
const VERSION = '2.0.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(code, status = 400) { return Object.assign(new Error(code), { status }); }
function uuid(value) { if (!UUID.test(String(value || ''))) throw failure('invalid_identifier'); return value; }
function deviceDto(d) { return { id: d.id, kioskId: d.kiosk_id, storeCode: d.store_code, printerId: d.printer_id, capabilities: d.capabilities }; }
function createPrintV2Api({ rpc, select, supabaseFetch, requireAdmin, log = () => {}, env = process.env, localAuthenticate, eventResponse, rateLimit }) {
  const reply = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-print-protocol': '2', 'x-backend-version': env.VERCEL_GIT_COMMIT_SHA || VERSION } });
  async function authenticate(request) {
    const token = String(request.headers.get('authorization') || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) throw failure('device_authentication_required', 401);
    let device;
    if (localAuthenticate) device = await localAuthenticate(token);
    else {
      const user = await supabaseFetch('/auth/v1/user', { bearer: token, apiKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY });
      if (!user?.id || user.error) throw failure('device_token_invalid', 401);
      device = (await select('print_devices', `auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`))[0];
    }
    if (!device || !device.active || device.revoked_at) throw failure('device_revoked', 403);
    const kiosk = (await select('print_kiosks', `id=eq.${encodeURIComponent(device.kiosk_id)}&limit=1`))[0];
    if (!kiosk?.active || kiosk.protocol_version !== 2 || kiosk.printer_id !== device.printer_id || kiosk.store_code !== device.store_code) throw failure('device_scope_invalid', 403);
    return device;
  }
  async function invoke(name, body) {
    const result = await rpc(name, body);
    if (result?.error) {
      const code = String(result.error);
      throw failure(code, /revoked|scope|owner|admin_required/.test(code) ? 403 : /expired|conflict|transition|review|stale/.test(code) ? 409 : 400);
    }
    return result;
  }
  async function handle(request) {
    const path = new URL(request.url).pathname.replace('/api/local-postgres/', '/api/');
    if (!path.startsWith('/api/print/v2/')) return null;
    try {
      if (path === '/api/print/v2/enroll' && request.method === 'POST') return await enroll(request);
      if (path === '/api/print/v2/provision' && request.method === 'POST') return await provision(request);
      if (path === '/api/print/v2/resolve' && request.method === 'POST') {
        const actor = await requireAdmin(request); if (actor.response) return actor.response;
        const b = await request.json();
        return reply(await invoke('resolve_print_job_v2', { p_actor_id: actor.id, p_job_id: uuid(b.jobId), p_request_id: uuid(b.requestId), p_action: b.action, p_reason: b.reason, p_writer_stopped: b.writerStopped === true }));
      }
      const device = await authenticate(request);
      if (path === '/api/print/v2/events' && request.method === 'GET' && eventResponse) return eventResponse(request, device);
      if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
      const b = await request.json();
      if (['kioskId','storeCode','printerId','deviceId','sectorId'].some(k => b[k] !== undefined)) throw failure('client_scope_forbidden',403);
      const command = path.split('/').pop();
      log('info', 'print.command', { deviceId: device.id, kioskId: device.kiosk_id, protocol: 2, agentVersion: String(request.headers.get('x-print-agent-version') || 'unknown').slice(0,40), backendVersion: env.VERCEL_GIT_COMMIT_SHA || VERSION, command });
      if (command === 'bootstrap') {
        await invoke('record_print_device_session_v2',{p_device_id:device.id,p_version:String(request.headers.get('x-print-agent-version')||'unknown')});
        return reply({ protocol: 2, realtimeEnabled: env.PRINT_REALTIME_ENABLED !== '0', device: deviceDto(device), reconciliationMs: Math.max(60000, Number(env.PRINT_RECONCILIATION_MS) || 600000), transport: localAuthenticate ? 'sse' : 'supabase', supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY, topic: `senhahub:print:v2:${device.kiosk_id}` });
      }
      const args = { p_device_id: device.id };
      const names = { claim: 'claim_next_print_job_v2', recover: 'recover_print_execution_v2', start: 'start_print_job_v2', finish: 'finish_print_job_v2', renew: 'renew_print_lease_v2' };
      if (!names[command]) return reply({ error: 'route_not_found' },404);
      if (command === 'claim') args.p_request_id = uuid(b.requestId);
      if (['start','finish','renew'].includes(command)) {
        Object.assign(args, { p_job_id: uuid(b.jobId), p_lease_id: uuid(b.leaseId), p_attempt_version: b.attemptVersion });
        if (!Number.isInteger(b.attemptVersion) || b.attemptVersion < 1) throw failure('invalid_attempt');
      }
      if (command === 'finish') Object.assign(args, { p_outcome: b.outcome, p_error: String(b.error || '').slice(0,500) || null });
      return reply(await invoke(names[command],args));
    } catch (error) {
      const status = error.status || 503;
      // Do not log upstream response bodies: auth errors may include credentials.
      log('error','print.command_failed',{ status, code: status === 503 ? 'print_unavailable' : error.message });
      return reply({ error: status === 503 ? 'print_unavailable' : error.message }, status);
    }
  }
  function key() {
    const k = Buffer.from(env.PRINT_PROVISIONING_SECRET || '', 'hex');
    if (k.length !== 32) throw failure('provisioning_not_configured',503);
    return k;
  }
  async function provision(request) {
    if(localAuthenticate)throw failure('use_local_provisioning',404);
    const actor = await requireAdmin(request); if (actor.response) return actor.response;
    const b = await request.json(); key();
    const kiosk = (await select('print_kiosks', `id=eq.${encodeURIComponent(String(b.kioskId || ''))}&limit=1`))[0];
    if (!kiosk?.printer_id) throw failure('printer_registration_required');
    const id = crypto.randomUUID(), password = crypto.randomBytes(32).toString('base64url');
    const email = `print-${id}@devices.senhahub.invalid`;
    const user = await supabaseFetch('/auth/v1/admin/users', { method:'POST', body:{ email,password,email_confirm:true,app_metadata:{ identity_type:'print_device' } } });
    if (!user?.id) throw failure('provisioning_failed',503);
    const code = crypto.randomBytes(24).toString('base64url');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',key(),iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({email,password})),cipher.final()]);
    const secret = Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
    try {
      await invoke('provision_print_device_v2',{ p_actor_id:actor.id,p_device_id:id,p_auth_user_id:user.id,p_kiosk_id:kiosk.id,p_name:String(b.name || 'Print agent').slice(0,100),p_code_hash:crypto.createHash('sha256').update(code).digest('hex'),p_secret:secret });
    } catch (error) {
      // Auth user creation and the database registration are separate APIs.
      // Remove an orphan technical user if the transactional registration is
      // rejected, so a failed provisioning attempt cannot consume the scope.
      await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }).catch(() => {});
      throw error;
    }
    return reply({ deviceId:id,enrollmentCode:code,expiresIn:1800 },201);
  }
  async function enroll(request) {
    if(localAuthenticate)throw failure('use_local_provisioning',404);
    if(rateLimit && !await rateLimit(request))throw failure('enrollment_rate_limited',429);
    const b = await request.json();
    if (!/^[A-Za-z0-9_-]{32}$/.test(String(b.code || ''))) throw failure('invalid_enrollment',401);
    const pair = await invoke('consume_print_enrollment_v2',{p_code_hash:crypto.createHash('sha256').update(b.code).digest('hex')});
    if (!pair?.secret) throw failure('invalid_enrollment',401);
    const encrypted=Buffer.from(pair.secret,'base64'), decipher=crypto.createDecipheriv('aes-256-gcm',key(),encrypted.subarray(0,12));
    decipher.setAuthTag(encrypted.subarray(12,28));
    const credentials=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)),decipher.final()]).toString());
    const session=await supabaseFetch('/auth/v1/token?grant_type=password',{ method:'POST',apiKey:env.SUPABASE_ANON_KEY,body:credentials });
    if (!session?.access_token) throw failure('enrollment_session_failed',503);
    return reply({ session, supabaseUrl:env.SUPABASE_URL,supabaseKey:env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY });
  }
  return { handle, authenticate };
}
module.exports = { createPrintV2Api, VERSION };
