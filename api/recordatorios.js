/*
 * Recordatorio de cita el día anterior (WhatsApp, plantilla aprobada por Meta).
 * Lo lanza Vercel Cron una vez al día. Solo recuerda citas reservadas por el bot
 * (notes = 'wa:<teléfono>'), en estado 'scheduled', del día siguiente (hora de Madrid),
 * y una sola vez por cita (appointments.recordatorio_enviado_at).
 * Si no existe WHATSAPP_PLANTILLA_RECORDATORIO no hace nada.
 */
const { createClient } = require('@supabase/supabase-js');
const { ahoraMadrid } = require('./_asistente');

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function enviarPlantilla(phoneNumberId, destino, plantilla, idioma, params) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const r = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: destino, type: 'template',
      template: { name: plantilla, language: { code: idioma }, components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) }] }
    })
  });
  if (!r.ok) { console.error('[recordatorios] envío falló', r.status, await r.text()); return false; }
  return true;
}

/* Núcleo (testeable): db y enviar se inyectan. Devuelve contadores. */
async function recordar({ db, enviar, ahora = new Date(), plantilla, idioma = 'es' }) {
  const res = { revisadas: 0, enviadas: 0, fallidas: 0 };
  if (!plantilla) return { ...res, aviso: 'sin plantilla configurada' };
  const manana = sumarDias(ahoraMadrid(ahora).fecha, 1);
  const { data: citas } = await db.from('appointments')
    .select('id,user_id,client_name,service,start_time,notes,recordatorio_enviado_at')
    .eq('appointment_date', manana).eq('status', 'scheduled');
  for (const c of citas || []) {
    if (c.recordatorio_enviado_at || !/^wa:\d{6,15}$/.test(c.notes || '')) continue;
    res.revisadas++;
    const { data: num } = await db.from('asistente_numeros').select('phone_number_id').eq('user_id', c.user_id).maybeSingle();
    if (!num) { res.fallidas++; continue; }
    const { data: perfil } = await db.from('profiles').select('asistente').eq('id', c.user_id).maybeSingle();
    const negocio = (perfil && perfil.asistente && perfil.asistente.nombre_negocio) || 'el negocio';
    const nombre = (c.client_name || 'cliente').split(' ')[0];
    const hora = String(c.start_time || '').slice(0, 5);
    const ok = await enviar(num.phone_number_id, c.notes.slice(3), plantilla, idioma, [nombre, c.service || 'tu servicio', hora, negocio]);
    if (ok) {
      await db.from('appointments').update({ recordatorio_enviado_at: new Date().toISOString() }).eq('id', c.id);
      res.enviadas++;
    } else res.fallidas++;
  }
  return res;
}

module.exports = Object.assign(async (req, res) => {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.authorization !== `Bearer ${secreto}`) return res.status(401).json({ error: 'no autorizado' });
  try {
    const r = await recordar({ db: sb(), enviar: enviarPlantilla, plantilla: process.env.WHATSAPP_PLANTILLA_RECORDATORIO, idioma: process.env.WHATSAPP_PLANTILLA_IDIOMA || 'es' });
    console.log('[recordatorios]', JSON.stringify(r));
    return res.status(200).json(r);
  } catch (e) {
    console.error('[recordatorios] error', e);
    return res.status(500).json({ error: 'fallo' });
  }
}, { recordar });
