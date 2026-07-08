// ================================================
// Cloudflare Pages Function: ventas.js
// Ventas de Morena Tropical. Cada venta trae uno o más productos
// (venta_items) y descuenta el stock automáticamente.
//
// GET    /ventas                         → lista ventas (con items)
// GET    /ventas?estado=pendiente        → filtra por estado (pendiente|parcial|pagada)
// GET    /ventas?desde=&hasta=           → filtra por rango de fecha
// POST   /ventas                         → crea una venta nueva
//   body: { cliente_nombre?, cliente_telefono?, tipo_pago, moneda_pago,
//            tasa_usada?, items:[{producto_id, nombre_producto, cantidad, precio_unit_usd}] }
// DELETE /ventas?id=...                  → anula una venta y repone el stock
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
        // ── GET: listar ventas con sus items ──
        if (request.method === 'GET') {
            const estado = url.searchParams.get('estado');
            const desde = url.searchParams.get('desde');
            const hasta = url.searchParams.get('hasta');
            let filtro = '';
            if (estado) filtro += `&estado=eq.${estado}`;
            if (desde) filtro += `&fecha=gte.${desde}`;
            if (hasta) filtro += `&fecha=lte.${hasta}`;

            const ventas = await supabaseFetch(
                env, `ventas?select=*${filtro}&order=created_at.desc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );

            const ids = (ventas || []).map(v => v.id);
            let items = [];
            if (ids.length > 0) {
                const idsList = ids.join(',');
                items = await supabaseFetch(
                    env, `venta_items?venta_id=in.(${idsList})&select=*`,
                    { method: 'GET' }
                ) || [];
            }
            const data = (ventas || []).map(v => ({
                ...v,
                items: items.filter(it => it.venta_id === v.id),
            }));

            return new Response(JSON.stringify({ ok: true, data }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        // ── POST: crear venta ──
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const {
                cliente_nombre, cliente_telefono, tipo_pago, moneda_pago,
                tasa_usada, items, fecha,
            } = body;

            if (!Array.isArray(items) || items.length === 0) {
                return new Response(JSON.stringify({ error: 'La venta necesita al menos un producto' }), {
                    status: 400, headers: CORS,
                });
            }
            const tipoPago = ['contado', 'fiado', 'cuotas'].includes(tipo_pago) ? tipo_pago : 'contado';
            const monedaPago = moneda_pago === 'Bs' ? 'Bs' : 'USD';
            if (monedaPago === 'Bs' && !tasa_usada) {
                return new Response(JSON.stringify({ error: 'Falta la tasa para venta en Bs' }), {
                    status: 400, headers: CORS,
                });
            }

            const totalUsd = items.reduce((acc, it) =>
                acc + (parseFloat(it.precio_unit_usd) * parseInt(it.cantidad, 10)), 0);

            const esAlContado = tipoPago === 'contado';
            const abonadoInicial = esAlContado ? totalUsd : 0;
            const saldoInicial = esAlContado ? 0 : totalUsd;

            const nuevaVenta = await supabaseFetch(env, 'ventas', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    fecha: fecha || new Date().toISOString().slice(0, 10),
                    cliente_nombre: cliente_nombre?.trim() || null,
                    cliente_telefono: cliente_telefono?.replace(/\D/g, '') || null,
                    tipo_pago: tipoPago,
                    moneda_pago: monedaPago,
                    tasa_usada: monedaPago === 'Bs' ? parseFloat(tasa_usada) : (tasa_usada ? parseFloat(tasa_usada) : null),
                    total_usd: totalUsd,
                    abonado_usd: abonadoInicial,
                    saldo_usd: saldoInicial,
                    estado: esAlContado ? 'pagada' : 'pendiente',
                }),
            });
            const venta = nuevaVenta?.[0];
            if (!venta) throw new Error('No se pudo crear la venta');

            // Crear los items y descontar stock
            const itemsPayload = items.map(it => ({
                venta_id: venta.id,
                producto_id: it.producto_id || null,
                nombre_producto: it.nombre_producto,
                cantidad: parseInt(it.cantidad, 10),
                precio_unit_usd: parseFloat(it.precio_unit_usd),
                subtotal_usd: parseFloat(it.precio_unit_usd) * parseInt(it.cantidad, 10),
            }));
            await supabaseFetch(env, 'venta_items', {
                method: 'POST',
                headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify(itemsPayload),
            });

            // Descontar stock producto por producto
            for (const it of items) {
                if (!it.producto_id) continue;
                try {
                    const prod = await supabaseFetch(env, `productos?id=eq.${it.producto_id}&select=stock`, { method: 'GET' });
                    const stockActual = prod?.[0]?.stock ?? 0;
                    const nuevoStock = Math.max(0, stockActual - parseInt(it.cantidad, 10));
                    await supabaseFetch(env, `productos?id=eq.${it.producto_id}`, {
                        method: 'PATCH',
                        headers: { 'Prefer': 'return=minimal' },
                        body: JSON.stringify({ stock: nuevoStock }),
                    });
                } catch (e) {
                    console.warn('No se pudo descontar stock de', it.producto_id, e);
                }
            }

            return new Response(JSON.stringify({ ok: true, data: { ...venta, items: itemsPayload } }), {
                status: 201, headers: CORS,
            });
        }

        // ── DELETE: anular venta y reponer stock ──
        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            const items = await supabaseFetch(env, `venta_items?venta_id=eq.${id}&select=*`, { method: 'GET' }) || [];
            for (const it of items) {
                if (!it.producto_id) continue;
                try {
                    const prod = await supabaseFetch(env, `productos?id=eq.${it.producto_id}&select=stock`, { method: 'GET' });
                    const stockActual = prod?.[0]?.stock ?? 0;
                    await supabaseFetch(env, `productos?id=eq.${it.producto_id}`, {
                        method: 'PATCH',
                        headers: { 'Prefer': 'return=minimal' },
                        body: JSON.stringify({ stock: stockActual + it.cantidad }),
                    });
                } catch (e) {
                    console.warn('No se pudo reponer stock de', it.producto_id, e);
                }
            }
            await supabaseFetch(env, `ventas?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('ventas error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
