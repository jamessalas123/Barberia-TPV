/* El dueño pega la web de un negocio y recibe los datos para una demo (se revisan en la app antes de guardar). */
const { createClient } = require('@supabase/supabase-js');
const { leerWeb } = require('./_web');
const { extraerDatos } = require('./_demo_extraer');
const { crearLLMAnthropic } = require('./_llm');

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const MAX_DIA = 30;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Inicia sesión para usar esto.' });
    const db = sb();
    const { data: u } = await db.auth.getUser(token);
    if (!u || !u.user) return res.status(401).json({ error: 'Sesión no válida.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'La IA no está configurada.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: previos } = await db.from('agente_registro').select('id').eq('user_id', u.user.id).eq('herramienta', 'demo_analizar').gte('created_at', desde);
    if ((previos || []).length >= MAX_DIA) return res.status(429).json({ error: 'Has llegado al límite de análisis de hoy.' });
    let web;
    try { web = await leerWeb(String(body.url || '').trim()); } catch (e) { return res.status(400).json({ error: e.message || 'No se pudo leer la web.' }); }
    if (web.texto.length < 80) return res.status(422).json({ error: 'La web casi no tiene texto que leer. Rellena los datos a mano.' });
    await db.from('agente_registro').insert({ user_id: u.user.id, canal: 'demo', cliente: null, herramienta: 'demo_analizar', args: { url: web.url }, resultado: { chars: web.texto.length } });
    const llm = crearLLMAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.AGENTE_MODELO || undefined, maxTokens: 2000, timeoutMs: 40000 });
    const datos = await extraerDatos({ llm, texto: web.texto, url: web.url });
    return res.status(200).json({ url: web.url, datos });
  } catch (e) {
    console.error('[demo-analizar]', e && e.message);
    return res.status(500).json({ error: 'No se pudo analizar la web. Inténtalo de nuevo o rellena los datos a mano.' });
  }
};
