// ================================================
// Worker independiente SOLO para disparar el chequeo diario de cobros
// pendientes (fiado/cuotas). Cloudflare Pages Functions no soportan Cron
// Triggers directamente, así que este Worker chiquito llama al endpoint
// de Pages por HTTP una vez al día.
//
// Se despliega aparte con: npx wrangler deploy
// (usando el wrangler.toml de esta misma carpeta)
//
// IMPORTANTE: cambia la URL de abajo por el dominio real donde despliegues
// la app (el mismo que uses en Cloudflare Pages).
// ================================================

export default {
    async scheduled(event, env, ctx) {
        const url = `https://morena-tropical.pages.dev/check-cobros?secret=${env.CRON_SECRET}`;
        ctx.waitUntil(
            fetch(url).then(r => r.text()).then(txt => console.log('check-cobros:', txt))
        );
    },
};
