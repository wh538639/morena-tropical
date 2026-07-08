// ================================================
// Cloudflare Pages Function: check-cobros.js
// Se llama UNA VEZ AL DÍA desde el Worker con Cron Trigger.
//
// Por cada venta a "fiado" o "cuotas" con saldo pendiente (estado
// pendiente o parcial), calcula los días transcurridos desde la fecha
// base (el último abono, o la fecha de la venta si nunca ha abonado) y:
//   - A los 7 días  → push recordatorio suave.
//   - A los 15 días → push recordatorio.
//   - A los 30 días → push urgente.
//
// Cada hito solo dispara aviso UNA VEZ (notif_7_enviado / _15_ / _30_).
// Al registrar un abono (abonos.js) esos 3 campos se limpian, así el
// conteo de días vuelve a empezar desde cero.
//
// GET /check-cobros?secret=TU_CRON_SECRET
//
// Variables de entorno necesarias:
//   SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   CRON_SECRET
// ================================================

import { buildPushHTTPRequest } from '@pushforge/builder';

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

async function enviarPush(env, sub, titulo, body, tag) {
    const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);

    const { endpoint, headers, body: pushBody } = await buildPushHTTPRequest({
        privateJWK,
        subscription,
        message: {
            payload: { title: titulo, body, icon: './icon-192.png', tag },
            adminContact: 'mailto:soporte@morenatropical.app',
            options: { ttl: 3600, urgency: tag === 'cobro-30' ? 'high' : 'normal' },
        },
    });

    const resp = await fetch(endpoint, { method: 'POST', headers, body: pushBody });
    return resp.status; // 404/410 = suscripción muerta
}

function diasEntre(desdeStr, hastaStr) {
    const a = new Date(desdeStr + 'T00:00:00Z');
    const b = new Date(hastaStr + 'T00:00:00Z');
    return Math.round((b - a) / (24 * 3600 * 1000));
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (url.searchParams.get('secret') !== env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const hoy = new Date().toISOString().slice(0, 10);

        const ventas = await supabaseFetch(
            env, `ventas?select=*&estado=in.(pendiente,parcial)&tipo_pago=in.(fiado,cuotas)`,
            { method: 'GET' }
        );

        const avisos7 = [], avisos15 = [], avisos30 = [];

        for (const v of (ventas || [])) {
            // fecha base: último abono si existe, si no la fecha de la venta
            const abonos = await supabaseFetch(
                env, `abonos?venta_id=eq.${v.id}&select=fecha&order=fecha.desc&limit=1`, { method: 'GET' }
            );
            const base = abonos?.[0]?.fecha || v.fecha;
            const dias = diasEntre(base, hoy);

            if (dias >= 30 && !v.notif_30_enviado) {
                avisos30.push(v);
            } else if (dias >= 15 && !v.notif_15_enviado) {
                avisos15.push(v);
            } else if (dias >= 7 && !v.notif_7_enviado) {
                avisos7.push(v);
            }
        }

        for (const v of avisos7) {
            await supabaseFetch(env, `ventas?id=eq.${v.id}`, {
                method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ notif_7_enviado: true }),
            });
        }
        for (const v of avisos15) {
            await supabaseFetch(env, `ventas?id=eq.${v.id}`, {
                method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ notif_15_enviado: true }),
            });
        }
        for (const v of avisos30) {
            await supabaseFetch(env, `ventas?id=eq.${v.id}`, {
                method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
                body: JSON.stringify({ notif_30_enviado: true }),
            });
        }

        let notificados = 0;
        const totalAvisos = avisos7.length + avisos15.length + avisos30.length;

        if (totalAvisos > 0) {
            const subs = await supabaseFetch(env, 'push_subscriptions?select=*', { method: 'GET' });
            const expirados = [];

            const grupos = [
                { lista: avisos7,  tag: 'cobro-7',  titulo: '💌 Recordatorio de cobro',
                  msg: n => n === 1 ? `${avisos7[0].cliente_nombre || 'Un cliente'} tiene 7 días con saldo pendiente.`
                                     : `${n} clientas/es llevan 7 días con saldo pendiente.` },
                { lista: avisos15, tag: 'cobro-15', titulo: '⏰ Cobro pendiente hace 15 días',
                  msg: n => n === 1 ? `${avisos15[0].cliente_nombre || 'Un cliente'} lleva 15 días sin abonar.`
                                     : `${n} clientas/es llevan 15 días sin abonar.` },
                { lista: avisos30, tag: 'cobro-30', titulo: '🚨 Cobro urgente: 30 días pendiente',
                  msg: n => n === 1 ? `${avisos30[0].cliente_nombre || 'Un cliente'} lleva 30 días sin pagar el saldo.`
                                     : `${n} clientas/es llevan 30 días sin pagar el saldo.` },
            ];

            for (const sub of (subs || [])) {
                for (const g of grupos) {
                    if (g.lista.length === 0) continue;
                    try {
                        const status = await enviarPush(env, sub, g.titulo, g.msg(g.lista.length), g.tag);
                        if (status === 404 || status === 410) expirados.push(sub.endpoint);
                        else notificados++;
                    } catch (errPush) {
                        console.warn('Fallo enviando push a', sub.endpoint, errPush);
                    }
                }
            }

            for (const endpoint of [...new Set(expirados)]) {
                await supabaseFetch(env, `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
                    method: 'DELETE', headers: { 'Prefer': 'return=minimal' },
                }).catch(() => {});
            }
        }

        return new Response(JSON.stringify({
            ok: true,
            avisos7: avisos7.length,
            avisos15: avisos15.length,
            avisos30: avisos30.length,
            notificados,
        }), { status: 200 });

    } catch (err) {
        console.error('check-cobros error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
