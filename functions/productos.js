// ================================================
// Cloudflare Pages Function: productos.js
// CRUD del inventario de Morena Tropical.
//
// GET    /productos                    → lista todos los activos
// GET    /productos?incluirInactivos=1 → incluye descontinuados
// POST   /productos                    → crea un producto
// PATCH  /productos?id=...             → edita (o descontinúa con activo:false)
// DELETE /productos?id=...             → elimina definitivamente
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ================================================

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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
            const incluirInactivos = url.searchParams.get('incluirInactivos') === '1';
            const filtro = incluirInactivos ? '' : '&activo=eq.true';
            const data = await supabaseFetch(
                env,
                `productos?select=*${filtro}&order=nombre.asc`,
                { method: 'GET', headers: { 'Prefer': 'return=representation' } }
            );
            return new Response(JSON.stringify({ ok: true, data: data || [] }), {
                status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' },
            });
        }

        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const {
                nombre, descripcion, categoria, sku, imagen_url,
                precio_usd, costo_usd, stock, stock_minimo,
            } = body;

            if (!nombre || precio_usd === undefined || precio_usd === null) {
                return new Response(JSON.stringify({
                    error: 'Faltan campos obligatorios: nombre, precio_usd',
                }), { status: 400, headers: CORS });
            }

            const nuevo = await supabaseFetch(env, 'productos', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    nombre: nombre.trim(),
                    descripcion: descripcion?.trim() || null,
                    categoria: categoria?.trim() || null,
                    sku: sku?.trim() || null,
                    imagen_url: imagen_url || null,
                    precio_usd: parseFloat(precio_usd),
                    costo_usd: costo_usd !== undefined && costo_usd !== '' ? parseFloat(costo_usd) : null,
                    stock: stock !== undefined ? parseInt(stock, 10) : 0,
                    stock_minimo: stock_minimo !== undefined ? parseInt(stock_minimo, 10) : 0,
                }),
            });

            return new Response(JSON.stringify({ ok: true, data: nuevo?.[0] || null }), {
                status: 201, headers: CORS,
            });
        }

        if (request.method === 'PATCH') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            const body = await request.json().catch(() => ({}));
            const permitido = [
                'nombre', 'descripcion', 'categoria', 'sku', 'imagen_url',
                'precio_usd', 'costo_usd', 'stock', 'stock_minimo', 'activo',
            ];
            const cambios = {};
            for (const campo of permitido) {
                if (body[campo] !== undefined) cambios[campo] = body[campo];
            }
            if (cambios.precio_usd !== undefined) cambios.precio_usd = parseFloat(cambios.precio_usd);
            if (cambios.costo_usd !== undefined) cambios.costo_usd = cambios.costo_usd === '' ? null : parseFloat(cambios.costo_usd);
            if (cambios.stock !== undefined) cambios.stock = parseInt(cambios.stock, 10);
            if (cambios.stock_minimo !== undefined) cambios.stock_minimo = parseInt(cambios.stock_minimo, 10);

            if (Object.keys(cambios).length === 0) {
                return new Response(JSON.stringify({ error: 'Nada que actualizar' }), { status: 400, headers: CORS });
            }

            const actualizado = await supabaseFetch(env, `productos?id=eq.${id}`, {
                method: 'PATCH',
                headers: { 'Prefer': 'return=representation' },
                body: JSON.stringify(cambios),
            });

            return new Response(JSON.stringify({ ok: true, data: actualizado?.[0] || null }), {
                status: 200, headers: CORS,
            });
        }

        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Falta id' }), { status: 400, headers: CORS });
            }
            await supabaseFetch(env, `productos?id=eq.${id}`, {
                method: 'DELETE',
                headers: { 'Prefer': 'return=minimal' },
            });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

    } catch (err) {
        console.error('productos error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
    }
}
