/*
 * TEMPORAL — utilidad de diagnóstico para la prueba técnica de WhatsApp.
 * Se borra al terminar la prueba.
 *   ?key=<META_VERIFY_TOKEN>&action=status     -> ver si la cuenta WABA está suscrita a la app
 *   ?key=<META_VERIFY_TOKEN>&action=subscribe  -> suscribir la cuenta WABA a la app
 * Nunca devuelve ni registra tokens.
 */
const crypto = require('crypto');

const WABA_ID = '4567049276876008';

function claveValida(k) {
  const esperada = process.env.META_VERIFY_TOKEN || '';
  const a = Buffer.from(String(k || ''));
  const b = Buffer.from(esperada);
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  const q = req.query || {};
  if (!claveValida(q.key)) {
    res.status(403).json({ error: 'clave inválida' });
    return;
  }
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const base = `https://graph.facebook.com/${version}/${WABA_ID}/subscribed_apps`;
  const cabeceras = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  try {
    let r;
    if (q.action === 'subscribe') r = await fetch(base, { method: 'POST', headers: cabeceras });
    else r = await fetch(base, { headers: cabeceras });
    const texto = await r.text();
    res.status(200).json({ accion: q.action || 'status', http: r.status, meta: JSON.parse(texto) });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
