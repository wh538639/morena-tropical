// ================================================
// Cloudflare Pages Function: push-subscribe.js
// Guarda / elimina la suscripción push de la dueña del negocio.
//
// POST   /push-subscribe   body: { endpoint, keys: { p256dh, auth } }
// DELETE /push-subscribe   body: { endpoint }
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

async function supabaseFetch(env, path, options = {}) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            'apikey':        env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            ...(options.headers || {}),
        },
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase error ${resp.status}: ${err}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: CORS });
    }

    try {
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { endpoint, keys } = body;

            if (!endpoint || !keys?.p256dh || !keys?.auth) {
                return new Response(JSON.stringify({ error: 'Faltan endpoint o keys' }), {
                    status: 400, headers: CORS,
                });
            }

            await supabaseFetch(env, 'push_subscriptions?on_conflict=endpoint', {
                method: 'POST',
                headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
            });

            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        if (request.method === 'DELETE') {
            const body = await request.json().catch(() => ({}));
            const { endpoint } = body;
            if (!endpoint) {
                return new Response(JSON.stringify({ error: 'Falta endpoint' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('push-subscribe error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
