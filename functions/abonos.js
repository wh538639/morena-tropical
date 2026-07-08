// ================================================
// Cloudflare Pages Function: abonos.js
// Registra abonos (pagos parciales) sobre una venta a fiado o en cuotas.
// Actualiza abonado_usd / saldo_usd / estado de la venta y limpia los
// avisos de cobro ya enviados (para que el conteo de días se reinicie).
//
// GET  /abonos?venta_id=...   → historial de abonos de una venta
// POST /abonos                → registra un abono nuevo
//      body: { venta_id, monto_usd, moneda_pago?, tasa?, fecha? }
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
            const ventaId = url.searchParams.get('venta_id');
            if (!ventaId) {
                return new Response(JSON.stringify({ error: 'Falta venta_id' }), { status: 400, headers: CORS });
            }
            const data = await supabaseFetch(
                env, `abonos?venta_id=eq.${ventaId}&select=*&order=fecha.desc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const { venta_id, monto_usd, fecha } = body;
            const moneda_pago = body.moneda_pago === 'Bs' ? 'Bs' : 'USD';

            if (!venta_id || !monto_usd) {
                return new Response(JSON.stringify({ error: 'Faltan campos: venta_id, monto_usd' }), {
                    status: 400, headers: CORS,
                });
            }
            if (moneda_pago === 'Bs' && !body.tasa) {
                return new Response(JSON.stringify({ error: 'Falta la tasa para un abono en Bs' }), {
                    status: 400, headers: CORS,
                });
            }

            const venta = await supabaseFetch(env, `ventas?id=eq.${venta_id}&select=*`, { method: 'GET' });
            const ventaActual = venta?.[0];
            if (!ventaActual) {
                return new Response(JSON.stringify({ error: 'Venta no encontrada' }), { status: 404, headers: CORS });
            }

            const montoUsd = parseFloat(monto_usd);
            const tasaNum = moneda_pago === 'Bs' ? parseFloat(body.tasa) : null;
            const montoBs = moneda_pago === 'Bs' ? tasaNum * montoUsd : null;
            const fechaAbono = fecha || new Date().toISOString().slice(0, 10);

            const nuevoAbono = await supabaseFetch(env, 'abonos', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    venta_id, fecha: fechaAbono, monto_usd: montoUsd,
                    moneda_pago, tasa: tasaNum, monto_bs: montoBs,
                }),
            });

            const nuevoAbonado = parseFloat(ventaActual.abonado_usd) + montoUsd;
            const nuevoSaldo = Math.max(0, parseFloat(ventaActual.total_usd) - nuevoAbonado);
            const nuevoEstado = nuevoSaldo <= 0.009 ? 'pagada' : 'parcial';

            const ventaActualizada = await supabaseFetch(env, `ventas?id=eq.${venta_id}`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    abonado_usd: nuevoAbonado,
                    saldo_usd: nuevoSaldo,
                    estado: nuevoEstado,
                    // Reinicia el ciclo de avisos: al abonar, se le da de nuevo
                    // el margen completo de 7/15/30 días antes de recordarle.
                    notif_7_enviado: false,
                    notif_15_enviado: false,
                    notif_30_enviado: false,
                }),
            });

            return new Response(JSON.stringify({
                ok: true,
                data: nuevoAbono?.[0] || null,
                venta: ventaActualizada?.[0] || null,
            }), { status: 201, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('abonos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
