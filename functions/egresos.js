// ================================================
// Cloudflare Pages Function: egresos.js
// Egresos de Morena Tropical: pagos, inversión, reinversión, otros.
//
// GET    /egresos?desde=&hasta=&tipo=   → lista (todos los filtros opcionales)
// POST   /egresos                        → crea un egreso
// DELETE /egresos?id=...                 → elimina un egreso
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

const TIPOS_VALIDOS = ['pago', 'inversion', 'reinversion', 'otro'];

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: CORS });
    }

    try {
        if (request.method === 'GET') {
            const desde = url.searchParams.get('desde');
            const hasta = url.searchParams.get('hasta');
            const tipo = url.searchParams.get('tipo');
            let filtro = '';
            if (desde) filtro += `&fecha=gte.${desde}`;
            if (hasta) filtro += `&fecha=lte.${hasta}`;
            if (tipo) filtro += `&tipo=eq.${tipo}`;

            const data = await supabaseFetch(
                env, `egresos?select=*${filtro}&order=fecha.desc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { concepto, descripcion, monto, moneda, fecha } = body;
            const tipo = TIPOS_VALIDOS.includes(body.tipo) ? body.tipo : 'pago';

            if (!concepto || !monto || !moneda) {
                return new Response(JSON.stringify({
                    error: 'Faltan campos obligatorios: concepto, monto, moneda',
                }), { status: 400, headers: CORS });
            }
            if (moneda !== 'Bs' && moneda !== 'USD') {
                return new Response(JSON.stringify({ error: 'moneda debe ser Bs o USD' }), { status: 400, headers: CORS });
            }

            const nuevo = await supabaseFetch(env, 'egresos', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    concepto: concepto.trim(),
                    tipo,
                    descripcion: descripcion?.trim() || null,
                    monto: parseFloat(monto),
                    moneda,
                    fecha: fecha || new Date().toISOString().slice(0, 10),
                }),
            });

            return new Response(JSON.stringify({ ok: true, data: nuevo?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `egresos?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('egresos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
