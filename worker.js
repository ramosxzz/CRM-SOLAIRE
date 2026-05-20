const PUSH_TABLE = 'push_subscriptions';

function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{ 'Content-Type':'application/json; charset=utf-8' }
  });
}

function base64UrlToUint8Array(value=''){
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from([...binary].map(ch => ch.charCodeAt(0)));
}

function uint8ArrayToBase64Url(bytes){
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function derToJose(signature){
  const bytes = new Uint8Array(signature);
  if(bytes.length === 64) return bytes;
  let offset = 3;
  let rLen = bytes[offset++];
  let r = bytes.slice(offset, offset + rLen);
  offset += rLen + 1;
  let sLen = bytes[offset++];
  let s = bytes.slice(offset, offset + sLen);
  if(r[0] === 0) r = r.slice(1);
  if(s[0] === 0) s = s.slice(1);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

async function createVapidJwt(endpoint, env){
  const publicKey = env.VAPID_PUBLIC_KEY || '';
  const privateKey = env.VAPID_PRIVATE_KEY || '';
  if(!publicKey || !privateKey) throw new Error('VAPID nao configurado.');

  const pubBytes = base64UrlToUint8Array(publicKey);
  if(pubBytes.length !== 65 || pubBytes[0] !== 4) throw new Error('VAPID_PUBLIC_KEY invalida.');
  const x = uint8ArrayToBase64Url(pubBytes.slice(1, 33));
  const y = uint8ArrayToBase64Url(pubBytes.slice(33, 65));
  const d = privateKey;
  const aud = new URL(endpoint).origin;
  const header = { typ:'JWT', alg:'ES256' };
  const payload = {
    aud,
    exp:Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub:env.VAPID_SUBJECT || 'mailto:contato@solairesolar.com.br'
  };
  const encodedHeader = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty:'EC', crv:'P-256', x, y, d, ext:false, key_ops:['sign'] },
    { name:'ECDSA', namedCurve:'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name:'ECDSA', hash:'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${uint8ArrayToBase64Url(derToJose(signature))}`;
}

async function supabaseFetch(env, path, init={}){
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if(!env.SUPABASE_URL || !key) throw new Error('Supabase service role nao configurado.');
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers:{
      'apikey':key,
      'Authorization':`Bearer ${key}`,
      'Content-Type':'application/json',
      ...(init.headers || {})
    }
  });
}

async function getSubscriptions(env, vendedor){
  const query = `${PUSH_TABLE}?select=*&vendedor=eq.${encodeURIComponent(vendedor)}&limit=50`;
  const res = await supabaseFetch(env, query);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function deleteSubscription(env, endpoint){
  const query = `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`;
  await supabaseFetch(env, query, { method:'DELETE' });
}

async function upsertSubscription(env, data){
  const payload = {
    vendedor:String(data.vendedor || '').trim(),
    endpoint:String(data.endpoint || '').trim(),
    p256dh:String(data.p256dh || ''),
    auth:String(data.auth || ''),
    user_agent:String(data.user_agent || ''),
    updated_at:new Date().toISOString()
  };
  if(!payload.vendedor || !payload.endpoint) throw new Error('vendedor e endpoint sao obrigatorios.');
  const res = await supabaseFetch(env, `${PUSH_TABLE}?on_conflict=endpoint`, {
    method:'POST',
    headers:{ 'Prefer':'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify(payload)
  });
  if(!res.ok) throw new Error(await res.text());
  return payload;
}

async function sendPush(subscription, env){
  const token = await createVapidJwt(subscription.endpoint, env);
  const res = await fetch(subscription.endpoint, {
    method:'POST',
    headers:{
      'TTL':'3600',
      'Authorization':`vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Length':'0'
    }
  });
  if(res.status === 404 || res.status === 410){
    await deleteSubscription(env, subscription.endpoint);
  }
  return res.ok || res.status === 404 || res.status === 410;
}

async function handleNotifyLead(request, env){
  const body = await request.json().catch(() => ({}));
  const vendedor = String(body.vendedor || '').trim();
  if(!vendedor) return json({ ok:false, error:'vendedor obrigatorio' }, 400);
  const subscriptions = await getSubscriptions(env, vendedor);
  const results = await Promise.allSettled(subscriptions.map(sub => sendPush(sub, env)));
  return json({
    ok:true,
    vendedor,
    sent:results.filter(r => r.status === 'fulfilled' && r.value).length,
    total:subscriptions.length
  });
}

async function handleRegister(request, env){
  const body = await request.json().catch(() => ({}));
  const saved = await upsertSubscription(env, body);
  return json({ ok:true, vendedor:saved.vendedor });
}

async function proxyWhatsAppBackend(request, env){
  const backend = String(env.WHATSAPP_BACKEND_URL || '').replace(/\/+$/, '');
  if(!backend){
    return json({ ok:false, error:'WHATSAPP_BACKEND_URL nao configurada no Cloudflare.' }, 502);
  }
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/whatsapp-backend/, '') || '/';
  const upstream = new URL(`${backend}${upstreamPath}${url.search}`);
  const headers = new Headers(request.headers);
  headers.delete('host');
  return fetch(upstream, {
    method:request.method,
    headers,
    body:['GET','HEAD'].includes(request.method) ? undefined : request.body,
    redirect:'manual'
  });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    if(url.pathname === '/whatsapp-backend' || url.pathname.startsWith('/whatsapp-backend/')){
      return proxyWhatsAppBackend(request, env);
    }
    if(url.pathname === '/api/push/public-key'){
      return json({ publicKey:env.VAPID_PUBLIC_KEY || '' });
    }
    if(url.pathname === '/api/push/register' && request.method === 'POST'){
      try{
        return await handleRegister(request, env);
      }catch(err){
        return json({ ok:false, error:err.message || 'Erro ao registrar push' }, 500);
      }
    }
    if(url.pathname === '/api/push/notify-lead' && request.method === 'POST'){
      try{
        return await handleNotifyLead(request, env);
      }catch(err){
        return json({ ok:false, error:err.message || 'Erro ao enviar push' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
