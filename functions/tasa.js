// ================================================
// Cloudflare Pages Function: tasa.js
// Da la tasa del dólar/USDT para convertir a Bs:
//   - "binance": la trae en vivo desde la API pública de usdt.com.ve
//     (dataset de Binance P2P, actualizado cada 5 min, CORS habilitado).
//   - "personalizada": la que la dueña del negocio configuró a mano,
//     guardada en la tabla configuracion.
//
// GET   /tasa                    → { binance: {...}, personalizada: "..." }
// PATCH /tasa   body:{ tasa }    → actualiza la tasa personalizada
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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
        if (request.method === 'GET') {
            let binance = null;
            try {
                const resp = await fetch('https://www.usdt.com.ve/api/v1/rates/current', {
                    headers: { 'Accept': 'application/json' },
                });
                if (resp.ok) {
                    const json = await resp.json();
                    binance = json.binance || json.data?.binance || json;
                }
            } catch (e) {
                console.warn('No se pudo obtener la tasa Binance en vivo:', e);
            }

            const config = await supabaseFetch(env, `configuracion?clave=eq.tasa_personalizada&select=*`, { method: 'GET' });
            const personalizada = config?.[0]?.valor || '';

            return new Response(JSON.stringify({
                ok: true,
                binance,
                personalizada,
            }), { status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' } });
        }

        if (request.method === 'PATCH') {
            const body = await request.json().catch(() => ({}));
            if (body.tasa === undefined) {
                return new Response(JSON.stringify({ error: 'Falta tasa' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `configuracion?clave=eq.tasa_personalizada`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ valor: String(body.tasa) }),
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('tasa error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
