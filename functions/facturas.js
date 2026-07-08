// ================================================
// Cloudflare Pages Function: facturas.js
// Facturación de Morena Tropical. Puede generarse a partir de una venta
// ya registrada, o de forma independiente (items libres).
//
// GET    /facturas              → lista todas las facturas
// GET    /facturas?id=...       → obtiene una factura puntual
// POST   /facturas              → crea una factura y consume el número correlativo
// DELETE /facturas?id=...       → elimina una factura
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

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response('', { status: 204, headers: CORS });
    }

    try {
        if (request.method === 'GET') {
            const id = url.searchParams.get('id');
            if (id) {
                const data = await supabaseFetch(env, `facturas?id=eq.${id}&select=*`, { method: 'GET' });
                return new Response(JSON.stringify({ ok: true, data: data?.[0] || null }), {
                    status: 200, headers: CORS,
                });
            }
            const data = await supabaseFetch(
                env, 'facturas?select=*&order=created_at.desc',
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const {
                venta_id, cliente_nombre, cliente_rif, cliente_telefono,
                items, moneda, tasa_usada, fecha,
            } = body;

            if (!Array.isArray(items) || items.length === 0) {
                return new Response(JSON.stringify({ error: 'La factura necesita al menos un item' }), {
                    status: 400, headers: CORS,
                });
            }

            const subtotal = items.reduce((acc, it) =>
                acc + (parseFloat(it.precio_unit_usd) * parseInt(it.cantidad, 10)), 0);

            // Número correlativo desde configuracion
            const config = await supabaseFetch(env, `configuracion?clave=eq.siguiente_factura&select=*`, { method: 'GET' });
            const siguiente = parseInt(config?.[0]?.valor || '1', 10);
            const numero = `MT-${String(siguiente).padStart(5, '0')}`;

            const nueva = await supabaseFetch(env, 'facturas', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    venta_id: venta_id || null,
                    numero,
                    fecha: fecha || new Date().toISOString().slice(0, 10),
                    cliente_nombre: cliente_nombre?.trim() || null,
                    cliente_rif: cliente_rif?.trim() || null,
                    cliente_telefono: cliente_telefono?.replace(/\D/g, '') || null,
                    items,
                    subtotal_usd: subtotal,
                    total_usd: subtotal,
                    moneda: moneda === 'Bs' ? 'Bs' : 'USD',
                    tasa_usada: tasa_usada ? parseFloat(tasa_usada) : null,
                }),
            });

            await supabaseFetch(env, `configuracion?clave=eq.siguiente_factura`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ valor: String(siguiente + 1) }),
            });

            return new Response(JSON.stringify({ ok: true, data: nueva?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `facturas?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('facturas error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
