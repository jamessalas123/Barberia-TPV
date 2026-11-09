/*
 * Tarea "latido": una consulta mínima a la base de datos una vez al día (Vercel Cron),
 * para que Supabase vea actividad y no pause el proyecto en la capa gratuita.
 * No lee ni devuelve datos de nadie: solo comprueba que la base responde.
 * Mismo secreto que el resto de tareas programadas (CRON_SECRET).
 */
const { createClient } = require('@supabase/supabase-js');

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* Núcleo (testeable): db se inyecta. Devuelve { ok } sin ningún dato de la base. */
async function latir({ db }) {
  const { error } = await db.from('profiles').select('id', { count: 'exact', head: true });
  return { ok: !error };
}

module.exports = Object.assign(async (req, res) => {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.authorization !== `Bearer ${secreto}`) return res.status(401).json({ error: 'no autorizado' });
  try {
    const r = await latir({ db: sb() });
    console.log('[latido]', r.ok ? 'ok' : 'la base respondió con error');
    return res.status(r.ok ? 200 : 500).json(r);
  } catch (e) {
    console.error('[latido] error', e);
    return res.status(500).json({ ok: false });
  }
}, { latir });
