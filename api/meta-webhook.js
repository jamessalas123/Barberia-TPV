/*
 * Webhook de WhatsApp Business Platform (Cloud API de Meta).
 * PRUEBA TÉCNICA: verifica el webhook y responde con un eco (v2: tras cargar variables de entorno).
 * Aún no usa IA ni toca la agenda.
 *
 * Variables de entorno (Vercel):
 *   META_VERIFY_TOKEN  texto que inventamos; Meta lo envía al verificar el webhook
 *   META_APP_SECRET    "Clave secreta de la app" (Configuración > Básica); valida la firma
 *   WHATSAPP_TOKEN     token de acceso para enviar mensajes
 *   META_GRAPH_VERSION opcional, por defecto v23.0
 */
const crypto = require('crypto');

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

function firmaValida(cuerpo, cabecera) {
  const secreto = process.env.META_APP_SECRET;
  if (!secreto || !cabecera || !cabecera.startsWith('sha256=')) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
  const recibida = cabecera.slice(7);
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(recibida, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function enviarTexto(phoneNumberId, destino, texto) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  const r = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'text',
      text: { body: texto }
    })
  });
  if (!r.ok) console.error('[meta-webhook] envío falló', r.status, await r.text());
}

module.exports = Object.assign(async (req, res) => {
  /* 1. Verificación inicial: Meta hace un GET con hub.* */
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
      res.status(200).send(q['hub.challenge']);
    } else {
      res.status(403).send('Verificación rechazada');
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  /* 2. Eventos: comprobamos que vienen de Meta con la firma HMAC */
  const cuerpo = await leerCuerpo(req);
  if (!firmaValida(cuerpo, req.headers['x-hub-signature-256'])) {
    res.status(403).send('Firma inválida');
    return;
  }

  let evento;
  try {
    evento = JSON.parse(cuerpo.toString('utf8'));
  } catch (e) {
    res.status(400).send('JSON inválido');
    return;
  }

  try {
    for (const entrada of evento.entry || []) {
      for (const cambio of entrada.changes || []) {
        const v = cambio.value || {};
        const phoneNumberId = v.metadata && v.metadata.phone_number_id;
        for (const m of v.messages || []) {
          if (m.type !== 'text' || !phoneNumberId) continue;
          await enviarTexto(
            phoneNumberId,
            m.from,
            `Recibí tu mensaje: "${m.text.body}". (Prueba técnica de Escalia Digital)`
          );
        }
      }
    }
  } catch (e) {
    console.error('[meta-webhook] error', e);
  }

  /* Siempre 200 para que Meta no reintente */
  res.status(200).send('ok');
}, { config: { api: { bodyParser: false } } });
