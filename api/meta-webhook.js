/*
 * Webhook de WhatsApp Business Platform (Cloud API de Meta).
 * v4: asistente de citas con comandos fijos (SIN IA). Ver api/_asistente.js.
 * Cada número de WhatsApp (phone_number_id) se asocia a un negocio en la tabla asistente_numeros.
 *
 * Variables de entorno (Vercel):
 *   META_VERIFY_TOKEN  texto que inventamos; Meta lo envía al verificar el webhook
 *   META_APP_SECRET    "Clave secreta de la app" (Configuración > Básica); valida la firma
 *   WHATSAPP_TOKEN     token de acceso para enviar mensajes
 *   META_GRAPH_VERSION opcional, por defecto v23.0
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  acceso del servidor a la agenda
 */
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { procesar, ahoraMadrid } = require('./_asistente.js');
const { huecosLibres } = require('./_huecos.js');
const { correrAgente, historialCompacto } = require('./_agente.js');
const { herramientas, instrucciones } = require('./_agente_citas.js');
const { crearLLMAnthropic } = require('./_llm.js');

const MAX_TEXTO = 1000;          // caracteres máximos que leemos de un mensaje
const MEMORIA_HORAS = 24;        // la conversación se olvida pasadas estas horas

const vistos = new Set(); // ids de mensaje ya atendidos (reintentos de Meta)
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sumaDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* Carga los datos del negocio y atiende un mensaje; devuelve el texto a responder (o null). */
async function atender(phoneNumberId, m, nombreCliente, opts = {}) {
  const db = sb();
  const { data: num } = await db.from('asistente_numeros').select('user_id').eq('phone_number_id', phoneNumberId).maybeSingle();
  if (!num) { console.error('[meta-webhook] número sin negocio asociado', phoneNumberId); return null; }
  const uid = num.user_id;
  const ahora = ahoraMadrid();
  const tope = sumaDias(ahora.fecha, 61);
  const [{ data: perfil }, { data: servs }, { data: citas }, { data: mias }] = await Promise.all([
    db.from('profiles').select('nombre,horario,asistente').eq('id', uid).maybeSingle(),
    db.from('servicios').select('nombre,precio,duracion_min').eq('user_id', uid).order('created_at', { ascending: true }),
    db.from('appointments').select('appointment_date,start_time,duration_minutes,status,barbero').eq('user_id', uid).neq('status', 'cancelled').gte('appointment_date', ahora.fecha).lte('appointment_date', tope),
    db.from('appointments').select('id,appointment_date,start_time,service,barbero,status').eq('user_id', uid).eq('notes', 'wa:' + m.from).eq('status', 'scheduled').gte('appointment_date', ahora.fecha).order('appointment_date').order('start_time')
  ]);
  const vistosNombre = new Set();
  const servicios = (servs || []).filter(s => { const k = String(s.nombre).toLowerCase().trim(); if (vistosNombre.has(k)) return false; vistosNombre.add(k); return true; });
  const porDia = {};
  (citas || []).forEach(c => (porDia[c.appointment_date] = porDia[c.appointment_date] || []).push(c));
  const negocio = { nombre: perfil && perfil.asistente && perfil.asistente.nombre_negocio, horario: perfil && perfil.horario, equipo: (perfil && perfil.asistente && perfil.asistente.equipo) || [], servicios };
  const texto = String(m.text.body || '').slice(0, MAX_TEXTO);
  const crearCita = async (c) => {
    /* Comprobación final contra la base de datos (por si otro cliente reservó justo antes) */
    const { data: hoyCitas } = await db.from('appointments').select('start_time,duration_minutes,status,barbero').eq('user_id', uid).eq('appointment_date', c.appointment_date).neq('status', 'cancelled');
    const libres = huecosLibres({ fecha: c.appointment_date, duracion: c.duration_minutes, horario: negocio.horario, citas: hoyCitas || [], profesional: c.barbero, ahora });
    if (!libres.includes(c.start_time.slice(0, 5))) return { ok: false, motivo: 'justo se acaba de ocupar ese hueco' };
    const { error } = await db.from('appointments').insert({ ...c, user_id: uid });
    if (error) { console.error('[meta-webhook] no se pudo crear la cita', error.message); return { ok: false, motivo: 'no se pudo guardar' }; }
    (porDia[c.appointment_date] = porDia[c.appointment_date] || []).push({ start_time: c.start_time, duration_minutes: c.duration_minutes, status: 'scheduled', barbero: c.barbero });
    return { ok: true };
  };
  const cancelarCita = async (id) => {
    const { error } = await db.from('appointments').update({ status: 'cancelled' }).eq('id', id).eq('user_id', uid).eq('notes', 'wa:' + m.from);
    if (error) { console.error('[meta-webhook] no se pudo cancelar', error.message); return { ok: false }; }
    return { ok: true };
  };

  /* Modo agente (IA): solo si hay clave de IA (o una IA inyectada en pruebas). Si falla, seguimos con los comandos. */
  const llm = opts.llm || (process.env.ANTHROPIC_API_KEY ? crearLLMAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.AGENTE_MODELO || undefined }) : null);
  if (llm) {
    try {
      return await atenderConIA({ db, uid, llm, phoneNumberId, m, texto, nombreCliente, ahora, negocio, porDia, mias: mias || [], crearCita, cancelarCita });
    } catch (e) { console.error('[meta-webhook] agente falló, uso comandos:', e && e.message); }
  }

  /* Modo comandos + conversación por reglas: el estado (datos a medio rellenar) se guarda 30 min */
  const { data: conv } = await db.from('asistente_conversaciones').select('mensajes,updated_at').eq('phone_number_id', phoneNumberId).eq('cliente', m.from).maybeSingle();
  const reciente = conv && conv.updated_at && (Date.now() - new Date(conv.updated_at).getTime()) < 30 * 60 * 1000;
  const estado = reciente && conv.mensajes && !Array.isArray(conv.mensajes) ? conv.mensajes.estado || null : null;
  const r = procesar({ texto, telefono: m.from, nombre: nombreCliente, ahora, negocio, citasDia: f => porDia[f] || [], citasCliente: mias || [], estado });
  await db.from('asistente_conversaciones').upsert({ phone_number_id: phoneNumberId, cliente: m.from, mensajes: { estado: r.estado || null }, updated_at: new Date().toISOString() });
  if (r.accion && r.accion.tipo === 'crear') {
    const res = await crearCita(r.accion.cita);
    if (!res.ok) return res.motivo === 'no se pudo guardar' ? 'No he podido guardar la cita. Inténtalo de nuevo en unos minutos.' : 'Justo se acaba de ocupar ese hueco 😕 Escribe HUECOS para ver las horas libres.';
  }
  if (r.accion && r.accion.tipo === 'cancelar') {
    const res = await cancelarCita(r.accion.id);
    if (!res.ok) return 'No he podido cancelar la cita. Inténtalo de nuevo en unos minutos.';
  }
  return r.respuesta;
}

async function atenderConIA({ db, uid, llm, phoneNumberId, m, texto, nombreCliente, ahora, negocio, porDia, mias, crearCita, cancelarCita }) {
  const { data: conv } = await db.from('asistente_conversaciones').select('mensajes,updated_at').eq('phone_number_id', phoneNumberId).eq('cliente', m.from).maybeSingle();
  const vigente = conv && conv.updated_at && (Date.now() - new Date(conv.updated_at).getTime()) < MEMORIA_HORAS * 3600 * 1000;
  const historial = vigente && Array.isArray(conv.mensajes) ? conv.mensajes : [];
  const ctx = { ahora, negocio, telefono: m.from, nombreCliente, citasDia: f => porDia[f] || [], citasCliente: () => mias, crearCita, cancelarCita };
  const registrar = async ({ herramienta, args, resultado }) => {
    await db.from('agente_registro').insert({ user_id: uid, canal: 'whatsapp', cliente: m.from, herramienta, args, resultado });
  };
  const r = await correrAgente({ llm, sistema: instrucciones(ctx), herramientas, ctx, historial, mensajeUsuario: texto, registrar });
  await db.from('asistente_conversaciones').upsert({ phone_number_id: phoneNumberId, cliente: m.from, mensajes: historialCompacto(r.mensajes), updated_at: new Date().toISOString() });
  return r.texto || 'Perdona, no te he entendido. ¿Puedes repetirlo?';
}

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
  else console.log('[meta-webhook] respuesta enviada OK');
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
  console.log('[meta-webhook] POST recibido, bytes=' + cuerpo.length + ', firma=' + (req.headers['x-hub-signature-256'] ? 'presente' : 'ausente'));
  if (!firmaValida(cuerpo, req.headers['x-hub-signature-256'])) {
    console.error('[meta-webhook] firma inválida (revisar META_APP_SECRET)');
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
        console.log('[meta-webhook] cambio campo=' + cambio.field + ' mensajes=' + (v.messages || []).length + ' estados=' + (v.statuses || []).length);
        for (const m of v.messages || []) {
          if (!phoneNumberId) continue;
          if (m.type !== 'text') {
            if (['audio', 'voice', 'image', 'video', 'document', 'sticker'].includes(m.type)) await enviarTexto(phoneNumberId, m.from, 'Por ahora solo entiendo mensajes de texto 🙂 ¿Me lo puedes escribir?');
            continue;
          }
          if (vistos.has(m.id)) continue;
          vistos.add(m.id); if (vistos.size > 500) vistos.clear();
          const nombreCliente = ((v.contacts || [])[0] || {}).profile && v.contacts[0].profile.name;
          const texto = await atender(phoneNumberId, m, nombreCliente);
          if (texto) await enviarTexto(phoneNumberId, m.from, texto);
        }
      }
    }
  } catch (e) {
    console.error('[meta-webhook] error', e);
  }

  /* Siempre 200 para que Meta no reintente */
  res.status(200).send('ok');
}, { config: { api: { bodyParser: false } }, atender });
