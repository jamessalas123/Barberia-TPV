/* Chat de demostración (público, solo con el código de la demo). GET = datos de cabecera; POST = mensaje. */
const { createClient } = require('@supabase/supabase-js');
const { atenderDemo, permitir, negocioDeDemo } = require('./_demo');
const { crearLLMAnthropic } = require('./_llm');
const { ahoraMadrid } = require('./_asistente');

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CODIGO = /^[a-z0-9-]{3,40}$/;

module.exports = Object.assign(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const db = sb();
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};
    const codigo = String((req.method === 'POST' ? body.c : req.query && req.query.c) || '').toLowerCase();
    if (!CODIGO.test(codigo)) return res.status(404).json({ error: 'Demostración no encontrada.' });
    const { data: demo } = await db.from('demos').select('codigo,nombre,config,activa,expira_at,mensajes_dia,dia').eq('codigo', codigo).maybeSingle();
    if (req.method === 'GET') {
      if (!demo || !demo.activa || new Date(demo.expira_at).getTime() < Date.now()) return res.status(404).json({ error: 'Demostración no disponible.' });
      return res.status(200).json({ nombre: demo.nombre, saludo: (demo.config && demo.config.saludo) || null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'La demostración no está configurada.' });
    const p = await permitir(db, demo, ahoraMadrid().fecha);
    if (!p.ok) return res.status(p.status).json({ error: p.error });
    const llm = crearLLMAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.AGENTE_MODELO || undefined });
    const r = await atenderDemo({ demo, mensaje: body.mensaje, historial: body.historial, citas: body.citas, llm });
    if (r.error) return res.status(400).json({ error: r.error });
    return res.status(200).json(r);
  } catch (e) {
    console.error('[demo-chat]', e && e.message);
    return res.status(500).json({ error: 'Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.' });
  }
}, {});
